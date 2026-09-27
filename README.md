# AntiLag

A modernized KoLmafia JavaScript latency helper based on the older AntiLag script by Irrat.

AntiLag measures your current KoL request latency using KoLmafia's native `ping` command, keeps a rolling local history, calculates a realistic "good connection" baseline, and can optionally make a bounded number of native KoLmafia `relog` attempts when latency is above your configured target.

This version is intended for **current KoLmafia** and runs directly as KoLmafia JavaScript. It does **not** require Node.js, npm, TypeScript, or an external build step.

## Installation

Use KoLmafia's gCLI:

```
git checkout https://github.com/donCannoli-burns/antilag.git main
```

KoLmafia will install the script as `antilag.js`.

After installing, verify it with:

```
antilag status
```

To update later:

```
git update antilag
```

You can also run `git update` with no project name to update all Git-installed KoLmafia projects.

## Quick start

First inspect the configuration:

```
antilag status
```

Run one latency measurement:

```
antilag check
```

Build the initial baseline dataset:

```
antilag bootstrap
```

Once the baseline exists, optionally allow AntiLag to make bounded relog attempts when the measured latency is above target:

```
antilag ensure
```

For first use, a conservative retry setting is recommended:

```
set antilag_max_attempts = 3
```

With `antilag_max_attempts = 3`, AntiLag performs **at most 3 total ping attempts and 2 relogs**. The first measurement happens before any relog.

## Commands

### `antilag`

Same as:

```
antilag check
```

Runs one native KoLmafia ping test, prints the current latency, records the result, and compares it with the stored baseline when enough history exists.

### `antilag check`

Runs one latency sample and records it.

If fewer than `antilag_min_dataset` samples exist, it reports baseline-building progress instead of judging the connection.

### `antilag bootstrap`

Fills the history until the minimum dataset size is reached.

Example with the default minimum of 10:

```
antilag bootstrap
```

If 1 sample already exists, the script collects the remaining 9.

This command does **not** relog.

### `antilag status`

Prints the active configuration and, when history exists, the calculated baseline and target.

Example:

```
AntiLag v2.0.1
Ping page: api
Pings per sample: 10
Stored samples: 10
Minimum dataset: 10
Maximum stored: 15
Ensure attempts: 3
Allowed above baseline: 20%
Current baseline: 696.9 ms
Current target: 836.3 ms
```

### `antilag ensure`

Checks the current latency against the stored target.

If the first measurement is already within target, AntiLag exits immediately and **does not relog**.

If it is above target, AntiLag may invoke KoLmafia's native:

```
relog
```

and measure again, up to the configured attempt limit.

AntiLag refuses to relog while KoLmafia reports an active fight, choice, choice/fight transition, or multi-fight.

### `antilag reset`

Clears only AntiLag v2's recorded latency history:

```
antilag reset
```

Use this after a meaningful network/environment change if you want a fresh baseline.

### `antilag help`

Displays the script's built-in command summary.

The following aliases also display help:

```
antilag --help
antilag -h
```

## Configuration

All configuration is stored as ordinary KoLmafia preferences and can be changed from the gCLI with `set`.

### Retry / relog attempts

```
set antilag_max_attempts = 3
```

Controls the maximum **total measurements** made by `antilag ensure`.

Examples:

| Setting | Maximum ping attempts | Maximum relogs |
| ---: | ---: | ---: |
| 1 | 1 | 0 |
| 2 | 2 | 1 |
| 3 | 3 | 2 |
| 5 | 5 | 4 |

The script default is `5` if the preference does not already exist.

Older AntiLag installations may already have this preference set; if so, the existing value is preserved.

### Allowed latency above baseline

```
set antilag_v2_threshold = 1.20
```

Default:

```
1.20
```

This means the current connection is considered acceptable up to 20% above the calculated baseline.

Examples:

| Value | Meaning |
| ---: | --- |
| 1.10 | allow 10% above baseline |
| 1.20 | allow 20% above baseline |
| 1.30 | allow 30% above baseline |

The target is:

```
baseline * threshold
```

### Minimum baseline dataset

```
set antilag_min_dataset = 10
```

Default:

```
10
```

AntiLag waits until at least this many recorded samples exist before using the history as a connection-quality baseline.

### Maximum stored history

```
set antilag_max_stored = 20
```

Default:

```
20
```

The stored history is rolling: old samples fall off as new samples are added.

The effective storage limit is never allowed to be smaller than `antilag_min_dataset`.

Older AntiLag installations may already have this preference set; if so, the existing value is preserved.

### Pings per sample

```
set antilag_v2_ping_count = 10
```

Default:

```
10
```

Each AntiLag sample delegates to KoLmafia's native `ping` command and uses the average result.

### Ping page

```
set antilag_v2_ping_page = api
```

Default:

```
api
```

Accepted values:

```
api
main
council
status
events
```

`api` is the recommended default.

### Failure warning

```
set antilag_warn_attempts_failed = true
```

Default:

```
true
```

When `ensure` exhausts its allowed attempts without reaching the target, AntiLag can ask whether the calling script should abort.

Set it to false to print the failure and return without that confirmation prompt:

```
set antilag_warn_attempts_failed = false
```

## Internal preferences

These normally do not need manual editing.

### `antilag_v2_ping_history`

Stores AntiLag v2's rolling latency history as comma-separated average ping values.

### `pingLatest`

This is a KoLmafia-owned preference written by KoLmafia's native ping subsystem. AntiLag reads it after executing `ping`.

Do not treat it as AntiLag-owned state.

## How the baseline works

The old AntiLag behavior was based heavily on the single fastest historical result.

AntiLag v2 instead uses the **lower quartile (25th percentile)** of stored average ping measurements.

That gives a "historically good" reference point without allowing one unusually fast outlier to make every ordinary session look bad forever.

Example history:

```
681.4
696.3
696.3
698.7
716.8
722.2
727.1
755.0
875.0
920.5
```

The calculated lower-quartile baseline is about:

```
696.9 ms
```

With the default threshold of `1.20`, the target is about:

```
836.3 ms
```

A measured average of `778.3 ms` is therefore accepted without relogging.

## What `ensure` actually does

The flow is intentionally bounded:

```
measure
  |
  +-- within target --> success, stop
  |
  +-- above target
         |
         +-- unsafe to relog --> stop with error
         |
         +-- attempts exhausted --> warn / optionally abort caller
         |
         +-- otherwise --> native KoLmafia relog --> measure again
```

AntiLag does not implement its own login/logout loop. It delegates relogging to current KoLmafia.

## Important note about relogging

Modern KoL server routing/load balancing means a relog is **not guaranteed** to give you a faster backend or lower latency.

For that reason:

- `check` is measurement-only.
- `bootstrap` is measurement-only.
- `ensure` is the only command that can intentionally relog.
- Relogging is bounded by `antilag_max_attempts`.
- If the current latency is already acceptable, `ensure` performs zero relogs.

Treat `ensure` as an optional compatibility/convenience behavior, not as a guarantee that KoL will route you to a faster server.

## Compatibility and implementation notes

AntiLag v2:

- targets current KoLmafia JavaScript;
- uses CommonJS `require("kolmafia")`;
- uses KoLmafia's native `ping` command;
- uses KoLmafia's native `relog` command;
- does not directly call `logout.php`;
- does not reimplement login loops;
- does not require Elvish sunglasses;
- does not use the old `antilag_lag_history` values because those historical measurements used a different timing method and are not directly comparable with native KoLmafia ping averages.

## Recommended first-use sequence

```
antilag status
antilag check
antilag bootstrap
set antilag_max_attempts = 3
antilag status
antilag ensure
```

The first four commands establish and inspect the baseline without forcing a relog.

## Uninstall

Use KoLmafia's Git project manager:

```
git delete antilag
```

You can inspect installed Git projects with:

```
git list
```

## KoLmafia references

Useful upstream references:

- KoLmafia source: https://github.com/kolmafia/kolmafia
- KoLmafia Wiki: https://wiki.kolmafia.us/
- CLI Reference: https://wiki.kolmafia.us/index.php/CLI_Reference
- JavaScript Support: https://wiki.kolmafia.us/index.php/JavaScript_Support
- Loathers scripting overview: https://www.loathers.net/scripting/scripting-overview/

KoLmafia's current Git command surface includes:

```
git checkout <giturl> [branch]
git update [project]
git list [project]
git delete <project>
git sync <project>
```

## Provenance

This is a modernization of the older AntiLag script associated with Irrat. The original implementation measured repeated requests manually and contained compatibility logic for older KoLmafia revisions.

Version 2 moves latency measurement and relogging onto current KoLmafia's native facilities while preserving the useful idea of keeping historical latency measurements and making a bounded decision about whether the current session is unusually slow.

## Version

Current script version:

```
2.0.1
```
