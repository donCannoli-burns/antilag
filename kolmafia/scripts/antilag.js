var kolmafia = require("kolmafia");

var VERSION = "2.0.1";

var PREF = {
  history: "antilag_v2_ping_history",
  threshold: "antilag_v2_threshold",
  minDataset: "antilag_min_dataset",
  maxAttempts: "antilag_max_attempts",
  maxStored: "antilag_max_stored",
  warnOnFailure: "antilag_warn_attempts_failed",
  pingCount: "antilag_v2_ping_count",
  pingPage: "antilag_v2_ping_page"
};

var DEFAULTS = {
  threshold: 1.20,
  minDataset: 10,
  maxAttempts: 5,
  maxStored: 20,
  warnOnFailure: true,
  pingCount: 10,
  pingPage: "api"
};

function isFiniteNumber(value) {
  return typeof value === "number" && isFinite(value);
}

function readInt(property, fallback, minimum) {
  var raw;
  var value;

  if (minimum === undefined) {
    minimum = 0;
  }

  raw = kolmafia.getProperty(property);
  value = parseInt(raw, 10);

  if (!isFiniteNumber(value) || value < minimum) {
    kolmafia.setProperty(property, String(fallback));
    return fallback;
  }

  return value;
}

function readFloat(property, fallback, minimum) {
  var raw;
  var value;

  if (minimum === undefined) {
    minimum = 0;
  }

  raw = kolmafia.getProperty(property);
  value = parseFloat(raw);

  if (!isFiniteNumber(value) || value < minimum) {
    kolmafia.setProperty(property, String(fallback));
    return fallback;
  }

  return value;
}

function readBoolean(property, fallback) {
  var raw = kolmafia.getProperty(property).toLowerCase();

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  kolmafia.setProperty(property, String(fallback));
  return fallback;
}

function normalizePingPage(value) {
  value = String(value).toLowerCase().trim();

  if (
    value === "api" ||
    value === "main" ||
    value === "council" ||
    value === "status" ||
    value === "events"
  ) {
    return value;
  }

  if (value === "(status)") {
    return "status";
  }

  if (value === "(events)") {
    return "events";
  }

  return null;
}

function readPingPage() {
  var raw = kolmafia.getProperty(PREF.pingPage);
  var page = normalizePingPage(raw);

  if (page !== null) {
    return page;
  }

  kolmafia.setProperty(PREF.pingPage, DEFAULTS.pingPage);
  return DEFAULTS.pingPage;
}

function getConfig() {
  var config = {};

  config.threshold = readFloat(
    PREF.threshold,
    DEFAULTS.threshold,
    1
  );

  config.minDataset = readInt(
    PREF.minDataset,
    DEFAULTS.minDataset,
    1
  );

  config.maxAttempts = readInt(
    PREF.maxAttempts,
    DEFAULTS.maxAttempts,
    1
  );

  config.maxStored = readInt(
    PREF.maxStored,
    DEFAULTS.maxStored,
    1
  );

  config.warnOnFailure = readBoolean(
    PREF.warnOnFailure,
    DEFAULTS.warnOnFailure
  );

  config.pingCount = readInt(
    PREF.pingCount,
    DEFAULTS.pingCount,
    1
  );

  config.pingPage = readPingPage();

  return config;
}

function parseNumber(value) {
  var parsed = Number(value);

  if (!isFiniteNumber(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

/*
 * Current KoLmafia PingManager saves pingLatest as:
 *
 * page:count:low:high:total:bytes:average
 */
function parsePingLatest() {
  var raw = kolmafia.getProperty("pingLatest");
  var fields = raw.split(":");

  var count;
  var low;
  var high;
  var total;
  var bytes;
  var average;

  if (fields.length < 7) {
    throw new Error(
      'Unable to parse KoLmafia pingLatest: "' + raw + '"'
    );
  }

  count = parseNumber(fields[1]);
  low = parseNumber(fields[2]);
  high = parseNumber(fields[3]);
  total = parseNumber(fields[4]);
  bytes = parseNumber(fields[5]);
  average = parseNumber(fields[6]);

  if (
    count === null ||
    low === null ||
    high === null ||
    total === null ||
    bytes === null ||
    average === null
  ) {
    throw new Error(
      'KoLmafia returned malformed ping data: "' + raw + '"'
    );
  }

  if (count === 0) {
    throw new Error(
      'KoLmafia ping test returned no usable measurements: "' +
        raw +
        '"'
    );
  }

  return {
    page: fields[0],
    count: count,
    low: low,
    high: high,
    total: total,
    bytes: bytes,
    average: average
  };
}

function runPing(config) {
  var command =
    "ping " +
    config.pingCount +
    " " +
    config.pingPage;

  if (!kolmafia.cliExecute(command)) {
    throw new Error(
      "KoLmafia failed to execute: " + command
    );
  }

  return parsePingLatest();
}

function loadHistory() {
  var raw = kolmafia.getProperty(PREF.history);
  var pieces;
  var output = [];
  var i;
  var value;

  if (raw.length === 0) {
    return output;
  }

  pieces = raw.split(",");

  for (i = 0; i < pieces.length; i++) {
    value = parseFloat(pieces[i]);

    if (isFiniteNumber(value) && value >= 0) {
      output.push(value);
    }
  }

  return output;
}

function saveHistory(values, maxStored) {
  var start = Math.max(0, values.length - maxStored);
  var trimmed = values.slice(start);
  var output = [];
  var i;

  for (i = 0; i < trimmed.length; i++) {
    output.push(trimmed[i].toFixed(2));
  }

  kolmafia.setProperty(
    PREF.history,
    output.join(",")
  );
}

function recordPing(result, config) {
  var history = loadHistory();

  history.push(result.average);

  saveHistory(
    history,
    Math.max(
      config.maxStored,
      config.minDataset
    )
  );
}

function percentile(values, percentileValue) {
  var sorted;
  var position;
  var lower;
  var upper;
  var fraction;

  if (values.length === 0) {
    throw new Error(
      "Cannot calculate percentile of an empty dataset."
    );
  }

  sorted = values.slice();

  sorted.sort(function(a, b) {
    return a - b;
  });

  if (sorted.length === 1) {
    return sorted[0];
  }

  percentileValue = Math.max(
    0,
    Math.min(1, percentileValue)
  );

  position =
    percentileValue *
    (sorted.length - 1);

  lower = Math.floor(position);
  upper = Math.ceil(position);

  if (lower === upper) {
    return sorted[lower];
  }

  fraction = position - lower;

  return (
    sorted[lower] +
    (sorted[upper] - sorted[lower]) *
      fraction
  );
}

function getBaseline(history) {
  return percentile(history, 0.25);
}

function getGoal(baseline, config) {
  return baseline * config.threshold;
}

function formatMs(value) {
  return value.toFixed(1) + " ms";
}

function printPing(result) {
  kolmafia.print(
    "Ping: avg " +
      formatMs(result.average) +
      ", low " +
      formatMs(result.low) +
      ", high " +
      formatMs(result.high) +
      " (" +
      result.count +
      " x " +
      result.page +
      ")",
    "blue"
  );
}

function safeToRelog() {
  if (kolmafia.currentRound() !== 0) {
    return false;
  }

  if (
    kolmafia.handlingChoice() ||
    kolmafia.choiceFollowsFight() ||
    kolmafia.fightFollowsChoice()
  ) {
    return false;
  }

  if (kolmafia.inMultiFight()) {
    return false;
  }

  return true;
}

function check() {
  var config = getConfig();
  var history = loadHistory();
  var result = runPing(config);
  var baseline;
  var goal;
  var good;

  printPing(result);

  if (history.length < config.minDataset) {
    kolmafia.print(
      "AntiLag is collecting a baseline: " +
        (history.length + 1) +
        "/" +
        config.minDataset +
        " samples.",
      "gray"
    );

    recordPing(result, config);
    return;
  }

  baseline = getBaseline(history);
  goal = getGoal(baseline, config);
  good = result.average <= goal;

  kolmafia.print(
    (good
      ? "Connection is within target. "
      : "Connection is above target. ") +
      "Baseline " +
      formatMs(baseline) +
      ", limit " +
      formatMs(goal) +
      ".",
    good ? "green" : "red"
  );

  recordPing(result, config);
}

function bootstrap() {
  var config = getConfig();
  var history = loadHistory();
  var needed;
  var i;
  var result;
  var baseline;

  if (
    history.length >=
    config.minDataset
  ) {
    kolmafia.print(
      "Baseline already has " +
        history.length +
        " samples; " +
        config.minDataset +
        " required.",
      "green"
    );

    return;
  }

  needed =
    config.minDataset -
    history.length;

  kolmafia.print(
    "Collecting " +
      needed +
      " ping sample" +
      (needed === 1 ? "" : "s") +
      "...",
    "blue"
  );

  for (i = 0; i < needed; i++) {
    result = runPing(config);

    kolmafia.print(
      "[" +
        (i + 1) +
        "/" +
        needed +
        "] " +
        formatMs(result.average),
      "gray"
    );

    history.push(result.average);
  }

  saveHistory(
    history,
    Math.max(
      config.maxStored,
      config.minDataset
    )
  );

  baseline = getBaseline(history);

  kolmafia.print(
    "Baseline ready: " +
      formatMs(baseline) +
      ".",
    "green"
  );
}

function ensure() {
  var config = getConfig();
  var history = loadHistory();
  var baseline;
  var goal;
  var attempts = [];
  var attempt;
  var result;
  var summary;
  var message;
  var i;

  if (
    history.length <
    config.minDataset
  ) {
    kolmafia.print(
      "AntiLag needs " +
        config.minDataset +
        " baseline samples before it can judge a connection; " +
        "currently have " +
        history.length +
        ".",
      "red"
    );

    kolmafia.print(
      "Run antilag bootstrap or use antilag check over time.",
      "gray"
    );

    return;
  }

  baseline = getBaseline(history);
  goal = getGoal(
    baseline,
    config
  );

  kolmafia.print(
    "Target: <= " +
      formatMs(goal) +
      " (baseline " +
      formatMs(baseline) +
      ", " +
      Math.round(
        (config.threshold - 1) *
          100
      ) +
      "% allowance).",
    "blue"
  );

  for (
    attempt = 1;
    attempt <=
    config.maxAttempts;
    attempt++
  ) {
    result = runPing(config);

    attempts.push(result.average);

    recordPing(
      result,
      config
    );

    kolmafia.print(
      "Attempt " +
        attempt +
        "/" +
        config.maxAttempts +
        ": " +
        formatMs(result.average),
      result.average <= goal
        ? "green"
        : "blue"
    );

    if (
      result.average <= goal
    ) {
      kolmafia.print(
        "Latency goal reached: " +
          formatMs(
            result.average
          ) +
          " <= " +
          formatMs(goal) +
          ".",
        "green"
      );

      return;
    }

    if (
      attempt ===
      config.maxAttempts
    ) {
      break;
    }

    if (!safeToRelog()) {
      throw new Error(
        "Connection is above the configured target, " +
          "but AntiLag will not relog during a fight, " +
          "choice, or multi-fight."
      );
    }

    kolmafia.print(
      "Connection is above target; requesting native KoLmafia relog...",
      "gray"
    );

    if (
      !kolmafia.cliExecute(
        "relog"
      )
    ) {
      throw new Error(
        "KoLmafia relog failed."
      );
    }
  }

  summary = "";

  for (
    i = 0;
    i < attempts.length;
    i++
  ) {
    if (i > 0) {
      summary += " > ";
    }

    summary += formatMs(
      attempts[i]
    );
  }

  message =
    "AntiLag made " +
    attempts.length +
    " attempt" +
    (attempts.length === 1
      ? ""
      : "s") +
    " without reaching " +
    formatMs(goal) +
    ".\n\n" +
    summary;

  kolmafia.print(
    message.replace(
      /\n/g,
      " "
    ),
    "red"
  );

  if (
    config.warnOnFailure &&
    kolmafia.userConfirm(
      message +
        "\n\nAbort the calling script?"
    )
  ) {
    throw new Error(
      "AntiLag abort requested by user."
    );
  }
}

function reset() {
  kolmafia.setProperty(
    PREF.history,
    ""
  );

  kolmafia.print(
    "AntiLag v2 latency history cleared.",
    "green"
  );
}

function status() {
  var config = getConfig();
  var history = loadHistory();
  var baseline;

  kolmafia.print(
    "AntiLag v" + VERSION,
    "blue"
  );

  kolmafia.print(
    "Ping page: " +
      config.pingPage,
    "gray"
  );

  kolmafia.print(
    "Pings per sample: " +
      config.pingCount,
    "gray"
  );

  kolmafia.print(
    "Stored samples: " +
      history.length,
    "gray"
  );

  kolmafia.print(
    "Minimum dataset: " +
      config.minDataset,
    "gray"
  );

  kolmafia.print(
    "Maximum stored: " +
      config.maxStored,
    "gray"
  );

  kolmafia.print(
    "Ensure attempts: " +
      config.maxAttempts,
    "gray"
  );

  kolmafia.print(
    "Allowed above baseline: " +
      Math.round(
        (config.threshold - 1) *
          100
      ) +
      "%",
    "gray"
  );

  if (history.length > 0) {
    baseline =
      getBaseline(history);

    kolmafia.print(
      "Current baseline: " +
        formatMs(baseline),
      "gray"
    );

    kolmafia.print(
      "Current target: " +
        formatMs(
          getGoal(
            baseline,
            config
          )
        ),
      "gray"
    );
  }
}

function help() {
  kolmafia.print(
    "AntiLag v" + VERSION,
    "blue"
  );

  kolmafia.print(
    "antilag check",
    "gray"
  );

  kolmafia.print(
    "  Run one KoLmafia ping test and record it.",
    "gray"
  );

  kolmafia.print(
    "antilag bootstrap",
    "gray"
  );

  kolmafia.print(
    "  Collect enough samples to establish a baseline.",
    "gray"
  );

  kolmafia.print(
    "antilag ensure",
    "gray"
  );

  kolmafia.print(
    "  Check latency and make bounded native relog attempts if needed.",
    "gray"
  );

  kolmafia.print(
    "antilag status",
    "gray"
  );

  kolmafia.print(
    "  Display configuration and baseline.",
    "gray"
  );

  kolmafia.print(
    "antilag reset",
    "gray"
  );

  kolmafia.print(
    "  Clear AntiLag v2 latency history.",
    "gray"
  );
}

function main(command) {
  var normalized;

  if (
    command === undefined ||
    command === null
  ) {
    normalized = "check";
  } else {
    normalized =
      String(command)
        .trim()
        .toLowerCase();

    if (
      normalized.length === 0
    ) {
      normalized = "check";
    }
  }

  if (normalized === "check") {
    check();
    return;
  }

  if (
    normalized ===
    "bootstrap"
  ) {
    bootstrap();
    return;
  }

  if (
    normalized === "ensure"
  ) {
    ensure();
    return;
  }

  if (
    normalized === "status"
  ) {
    status();
    return;
  }

  if (
    normalized === "reset"
  ) {
    reset();
    return;
  }

  if (
    normalized === "help" ||
    normalized === "--help" ||
    normalized === "-h"
  ) {
    help();
    return;
  }

  kolmafia.print(
    'Unknown AntiLag command: "' +
      normalized +
      '"',
    "red"
  );

  help();
}

module.exports.main = main;
