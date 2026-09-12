---
title: "Which Station Did This File Come From? Auditing Seven Years of River Sensor Data"
description: "How I audited and consolidated about four thousand files of river water-quality readings for a regional water agency: a catalogue that keeps every claim about a file's origin, a hydrochemical fingerprint that had to remain a suggestion, a DuckDB file instead of a database server, and the anomaly that turned out to be a model error."
pubDate: "2026-09-10"
image: "/assets/blog/which-station-did-this-file-come-from.webp"
tags: ["python", "duckdb", "pandas", "data-quality", "data-forensics", "data-engineering", "reliability"]
author: "Asier Ortiz"
draft: false
---

The brief from a regional water agency in northern Spain was a data-quality job. Thirteen river monitoring stations in two provinces had been recording water-quality readings every ten minutes since 2019, and a sensor contractor delivered them as monthly files. No systematic check of those files had been done until then. The agency wanted two things, in order: first an audit report listing every problem in the archive, with nothing altered; then, once the problems were understood, one spreadsheet per station with the complete series on a ten-minute grid. The archive itself was around four thousand files in four formats, with every problem a seven-year archive accumulates.

Four thousand files in four formats looked like a parsing job. The question that actually shaped the pipeline was smaller and harder: when a file's folder names one station and its export header names another, which one do you believe? Every file carried up to four such claims about where it came from, and none of them was authoritative. Most of this article is about how the pipeline decided which claims to trust, what it was allowed to repair on its own, what it could only suggest, and the one correction no analyzer could have made, because it required a fact about the world that was not in the data.

The stack is Python with pandas and openpyxl for the audit, DuckDB for the consolidation, and a small Streamlit app on top. Code samples are adapted from the codebase: identifiers translated to English, station names and sensor codes replaced with placeholders, logic unchanged.

---

## 📋 Table of Contents

<div class="not-prose mb-8 rounded-lg border border-base-700 bg-base-900 p-4">
  <ul class="flex flex-col gap-2">
    <li><a href="#1-the-problem-as-it-was-handed-to-me" class="text-base-300 hover:text-primary-400 transition-colors duration-300">1. The Problem as It Was Handed to Me</a></li>
    <li><a href="#2-choosing-the-approach" class="text-base-300 hover:text-primary-400 transition-colors duration-300">2. Choosing the Approach</a></li>
    <li><a href="#3-a-catalogue-that-trusts-nothing" class="text-base-300 hover:text-primary-400 transition-colors duration-300">3. A Catalogue That Trusts Nothing</a></li>
    <li><a href="#4-which-station-did-this-file-come-from" class="text-base-300 hover:text-primary-400 transition-colors duration-300">4. Which Station Did This File Come From?</a></li>
    <li><a href="#5-one-queryable-file" class="text-base-300 hover:text-primary-400 transition-colors duration-300">5. One Queryable File</a></li>
    <li><a href="#6-two-questions-the-pipeline-could-not-answer" class="text-base-300 hover:text-primary-400 transition-colors duration-300">6. Two Questions the Pipeline Could Not Answer</a></li>
    <li><a href="#7-the-anomaly-that-was-a-model-error" class="text-base-300 hover:text-primary-400 transition-colors duration-300">7. The Anomaly That Was a Model Error</a></li>
    <li><a href="#8-what-it-delivers" class="text-base-300 hover:text-primary-400 transition-colors duration-300">8. What It Delivers</a></li>
    <li><a href="#9-lessons-learned" class="text-base-300 hover:text-primary-400 transition-colors duration-300">9. Lessons Learned</a></li>
  </ul>
</div>

---

## 1. The Problem as It Was Handed to Me

The agency's own description of the archive at the kick-off meeting listed five kinds of failure:

- Missing data, from a few hours to whole months
- Different formats over the years: one file per parameter at first, later all parameters in one monthly Excel workbook
- Names that should agree and do not: the filename, the first rows of the export and the workbook's tab
- Columns that are not always in the same position
- Values out of range, mostly because a decimal comma had become a point, or had disappeared

The brief split the job into two phases. Phase one, the audit, covered one folder, the contractor's processed exports, and nothing outside it, and its output was a report listing every incident. Phase two, the consolidation, set the layout of each station's workbook: a single sheet, a timestamp column, then one column per parameter, with a row for every ten-minute slot whether or not a reading existed.

The order mattered because the agency's aim was evidence: a record of what had been delivered, month by month and file by file, that it could put in front of its supplier to claim the data that were missing or wrong. So nothing in phase one modifies a value, and every automatic correction in phase two is listed in a guide with its justification.

The data itself is what a multi-parameter probe produces: pH, conductivity, dissolved oxygen, temperature, turbidity, organic matter, ammonium, nitrate, phosphorus and orthophosphate, sampled every ten minutes, with the station's controller writing a header block before the readings.

| Format | Shape | Where the station is named |
|---|---|---|
| CSV, early years | One parameter per file, semicolon-separated, decimal comma, day-first dates | The folder, a sensor code in the filename, the export header |
| CSV, later years | One or a few parameters per file, controller serial in the filename | The folder, the export header, the serial |
| CSV, other province | One parameter per file, comma-separated, decimal point, year-first dates | The folder, the station name in the filename |
| XLSX | All parameters in one monthly workbook | The folder, the filename, the tab name |

Delimiter, decimal separator and date order vary by province and by period rather than by any flag inside the file. The one-parameter-per-file shape also means that a single early CSV says very little about which river it came from, which matters in section 4.

---

## 2. Choosing the Approach

| Question | Options considered | Choice | Why |
|---|---|---|---|
| When is the archive read in full? | Parse every file for the audit; parse headers only | Headers and tails for the catalogue, one streaming pass over values for ranges and fingerprints, full parse only in consolidation | The catalogue needs identity, dates and whether the file has data, and a few dozen lines from the top and the bottom answer that in seconds for four thousand files; the checks that need values can read them once and keep only aggregates |
| Where do the consolidated readings live? | A PostgreSQL server; a DuckDB file | DuckDB | The deliverable is a set of files the agency opens on a desktop; a single database file that runs the grid and the pivot in SQL, and can travel with the spreadsheets, fits that better than a server someone has to keep running |
| What happens to a file whose names contradict each other? | Move it to the station the data suggest; exclude it and suggest | Exclude from consolidation, suggest, leave the move to people | Ingesting a mislabeled month contaminates one clean series; a wrong relocation contaminates two |
| Which out-of-range values are repaired? | Flag everything; repair everything | Repair only the lost-decimal class, bounded by physical ranges; flag the rest | A conductivity of 563977 in fresh water has one plausible explanation; a pH of 15 has several |
| How are duplicate months resolved? | Ask about each; a rule | The file with more readings wins, ties by size, and every group is listed in the report | The fuller file is the safer default, and the list makes every choice reviewable |

Those decisions produce two lanes that fit in one picture: an audit lane that modifies nothing, and a consolidation lane that reads each remaining file once, repairs what physics constrains, and writes the grid.

<img src="/assets/blog/river-sensor-pipeline.svg" alt="Two lanes. Phase 1, the audit, modifies nothing: scan the archive into a catalogue of claims, parse headers and tails, run the analyzers for structure, naming, coverage, identity, ranges and duplicates, and write the incident workbook. Phase 2, the consolidation: parse each file in full, repair lost decimals within physical ranges, snap timestamps to the ten-minute grid, insert with INSERT OR IGNORE under a unique index on station, timestamp and parameter, then left-join a generate_series grid on a pivot to produce one workbook per station. Files with severe identity discrepancies flow from the audit into an exclusion list and never enter phase 2" data-zoomable />

---

## 3. A Catalogue That Trusts Nothing

Phase one starts with a scan that walks the archive and produces one row per file, and the row keeps every claim about the file's station in its own column so that a later analyzer can compare them. The row also carries a working station, taken from the folder and then the filename, for the analyzers that need one; the identity check never reads it.

```python
@dataclass
class CatalogEntry:
    path: str
    file_format: FileFormat            # CSV_EARLY, CSV_LATER, CSV_OTHER, XLSX
    year: int | None
    month: int | None
    station_from_path: str | None      # the folder the file sits in
    station_from_filename: str | None  # a station name in the filename, if any
    station_from_header: str | None    # the LOCATION line of the export
    station_from_sheet: str | None     # the workbook's tab name
    working_station: str | None        # folder, then filename; never read by the identity check
    parameters_found: list[str]
    has_data: bool
```

The first two station fields come from regular expressions over the path and the filename, one per format. The header and sheet fields come from a cheap parse: the first thirty-five lines of a CSV contain the controller's header block, with a location code and a serial number, and the last fifteen show whether the export ends in data or in blank lines. Workbooks are opened read-only for the tab name, the header row, a row count and the first and last date. Two later steps, the range check and the fingerprint's per-file statistics, do read every value once, but they keep aggregates and discard the readings.

Parameter names go through an alias table that folds about a hundred and thirty spellings into ten canonical parameters, and that table was among the most edited files in the project, because every batch of newly parsed files revealed a spelling nobody had seen.

From the catalogue, the analyzers are group-bys:

- **Folder structure:** names that deviate from the dominant pattern of their siblings
- **Naming:** files whose year and month do not match their folder
- **Coverage:** a station-by-month matrix with a state per cell: present, partial, missing, empty, stopped or inaccessible
- **Ranges:** readings outside the agency's thresholds, summarized per file and parameter as a count, a share, and the minimum and maximum seen
- **Duplicates:** more than one file for the same station, month and parameter, listed with size, row count and date range so a reviewer can compare them

A workbook on disk is not evidence of data: several monthly workbooks contained the header row and nothing else, and some of those had a stopped-station marker in the filename while others did not. The coverage matrix had to be refined by content, and the first version of that refinement looked for a key the CSV parser never set, so it marked forty-nine perfectly good station-months as empty. The regression was visible only against the previous run, where those forty-nine months had been present while nothing in the data had changed.

---

## 4. Which Station Did This File Come From?

Four sources can name a station: the folder, the filename, the export header and the workbook tab. The cross-reference analyzer normalizes the ones it reads for each format (codes, aliases and case folded to a canonical name) and reports a discrepancy when at least two are present and they disagree. For a CSV those are the folder, a station name in the filename when there is one, and the header; for a workbook, the filename and the tab. The early-format filename carries a sensor code rather than a station name, and the catalogue records it, but the analyzer does not read it as a claim, so for those files the test is folder against header.

```python
def station_claims(entry: CatalogEntry) -> dict[str, str]:
    sources = ("filename", "sheet") if entry.is_workbook else ("path", "filename", "header")
    claims = {}
    for source in sources:
        canonical = canonical_station(getattr(entry, f"station_from_{source}"))
        if canonical:
            claims[source] = canonical
    return claims


def is_discrepant(entry: CatalogEntry) -> bool:
    claims = station_claims(entry)
    return len(claims) >= 2 and len(set(claims.values())) > 1
```

Hundreds of files failed this test. The common pattern was a folder for one station holding CSVs whose header named another, sometimes in whole monthly batches. The agency had asked exactly this at the kick-off: when the names disagree, which station do the data actually belong to?

The evidence for an answer came in three kinds. Some claims were written in the files themselves: the folder, the filename, the header, the tab. Some could be inferred from the readings, which is what the rest of this section is about. And what a station actually was in the world, where its sensor stood and on which river, could only come from the agency, which is where section 7 ends up.

Rivers differ in their chemistry: conductivity is set largely by the geology of the catchment, while temperature and dissolved oxygen vary with the river's size and shading, and nutrient levels with whatever sits upstream. Each station therefore has something like a hydrochemical fingerprint, and a file's readings can be compared against it.

The profile for a station and parameter is built from workbooks and from CSVs that pass the identity check, pooling per-file statistics into one mean and one standard deviation. Each file contributes its own count, mean and spread, so the pooled variance is the weighted within-file variance plus the weighted spread of the file means, which is the law of total variance applied to aggregates from one streaming pass over each file. The thing being ranked is a workbook on its own or, for the early CSVs with one parameter per file, a whole folder-month batch pooled the same way, so that a batch of one-parameter files is judged once rather than file by file.

```python
def pooled_profile(stats: list[FileStats]) -> Profile:
    n = sum(s.n for s in stats)
    mean = sum(s.mean * s.n for s in stats) / n
    var = sum(s.n * (s.std**2 + (s.mean - mean) ** 2) for s in stats) / n
    return Profile(mean=mean, std=max(sqrt(var), 1e-6), n=n)


def rank_stations(file_stats: dict[str, FileStats], profiles) -> list[Candidate]:
    ranked = []
    for station, profile in profiles.items():
        shared = file_stats.keys() & profile.keys()
        if not shared:
            continue
        distance = fmean(
            abs(file_stats[p].mean - profile[p].mean) / profile[p].std
            for p in shared
        )
        ranked.append(Candidate(station, distance, n_params=len(shared)))
    return sorted(ranked, key=lambda c: c.distance)
```

The distance is the mean, over shared parameters, of how many standard deviations the file's mean sits from the station's. The ratio between the second-best and the best distance was labelled a confidence, above 2 high and above 1.3 medium, and the label was too strong for what it measured: a ranking heuristic, with no calibration behind it. A high or medium profile then counts as one of four pieces of evidence, alongside agreement from the header code, agreement from the controller serial, and a gap at the suggested station that month. Two or more pieces produce a "relocate to X" suggestion. Below that, a profile or a serial match on its own still produces "review, profile suggests X", and anything less produces "review manually".

In practice the evidence was weaker than the confidence labels made it look. Most files with a severe discrepancy were early-format CSVs, one parameter per file. The analyzer pooled each folder's monthly batch before ranking, yet the pooled statistics still usually covered a single parameter. The confidence did not account for that: the parameter count was printed beside the label but did not change it, and a conductivity mean alone can sit close to several stations and still produce a ratio above two. The nearest profile is only the nearest of the stations on offer, and with one parameter that says little about whether it is the right one. Whenever the fingerprint pointed back at the file's own folder station, the commonest outcome, the coverage-gap evidence was close to automatic, since that file had already been removed from the station's coverage before the question "does that station have a gap this month?" was asked. The result was a long list of confident suggestions, a number of them pointing at a station in a different river basin altogether.

The suggestions went into the delivered guide as decisions pending confirmation, and the files they concern stayed out of the consolidation rather than being moved: every file whose sources named two different stations counted as a severe discrepancy and was excluded, with one exception: workbooks whose tab carried the name of one particular station, the one whose export template had been reused for the others, were recorded as a milder discrepancy and ingested under their folder's station. The largest cluster of severe discrepancies turned out not to be misfiled at all, which section 7 takes up.

In the report, each of those files is one row with its claims and the verdict side by side. The values below are made up; the shape is the real one.

| File | Folder | Header or tab | Fingerprint | Action |
|---|---|---|---|---|
| `2020-07_S07_COND.csv` | Station B | S07, maps to Station A | Station A (medium, 1 parameter) | Review: profile suggests Station A |
| `2021-03_S11_PH.csv` | Station D | S11, maps to Station C | Station C (high, 1 parameter), gap at C that month | Relocate to Station C |
| `2023-05_monthly.xlsx` | Station E | tab: Station F | Station F (low, 2 parameters) | Review manually |

<img src="/assets/blog/river-sensor-file-identity.svg" alt="One CSV file carries two claims about its station: the folder says station B, the export header code maps to station A; the sensor code in the filename is recorded but not read as a claim. Four pieces of evidence are weighed: the hydrochemical fingerprint with its confidence, the header code, the controller serial, and whether the suggested station has a coverage gap that month. Two or more pieces give a relocation suggestion, a lone profile or serial match gives a review with a suggested station, anything less gives a manual review; in every case the file stays out of the consolidation until a person decides" data-zoomable />

---

## 5. One Queryable File

Phase two reads every file in full, once, into a DuckDB database with four tables: stations, parameters with their physical ranges, files, and readings.

```sql
CREATE TABLE readings (
    file_id   INTEGER   NOT NULL REFERENCES files(file_id),
    station   VARCHAR   NOT NULL REFERENCES stations(station),
    ts        TIMESTAMP NOT NULL,
    parameter VARCHAR   NOT NULL REFERENCES parameters(parameter),
    value     DOUBLE
);

CREATE UNIQUE INDEX readings_unique ON readings (station, ts, parameter);
```

The unique index is the consolidation's guardrail against duplicate keys. Duplicate months are resolved before ingest by the most-readings rule, but overlapping exports, re-sent files and the same reading appearing in a CSV and in a workbook all collapse on insert, because inserts are `INSERT OR IGNORE`. That is safe for exact duplicates and silent for the other case: two different values for the same station, slot and parameter keep whichever arrived first, and nothing counts how many rows were dropped. A conflicting value is a different incident from a duplicate, and it should have been logged rather than ignored. Every reading also keeps its `file_id`, so a value in the final spreadsheet can be traced to the file it came from.

From file to insert, the rows go through three steps.

**Parsing.** A single CSV reader covers the three CSV formats. It detects delimiter and decimal separator from the first data lines, not the header, and branches on the header layout, because some exports carry a column-header line and others only a comment line naming the parameters; workbooks get a separate reader. A round of parser fixes, most of them new parameter spellings and comment lines the controller emits in some exports, recovered over half a million readings from sixty-four files that had been counted as empty. The count of empty files was the signal: over a hundred was too many to be true.

**Repairing the lost decimal.** Most controllers export with a decimal comma. Somewhere between the controller and the archive some values lost it, so a conductivity of 563.977 arrives as 563977. The repair divides by powers of ten until the value falls within the parameter's physical range, and gives up if none does; the reader then drops that value rather than insert a reading the range says is impossible.

```python
DIVISORS = (10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000)


def repair_decimal(value: float, parameter: str) -> tuple[float, bool]:
    low, high = PHYSICAL_RANGE[parameter]
    if low <= value <= high:
        return value, False
    for divisor in DIVISORS:  # the first divisor that lands in range wins; see the caveat below
        candidate = value / divisor
        if low <= candidate <= high:
            return candidate, True
    return value, False
```

The repair is bounded, so any repaired value stays inside the parameter's physical range. That guarantee is weaker than it sounds. Nine of the ten ranges start at zero, so once one divisor lands inside the range every larger divisor does too, and the rule takes the first, which is right only when the true value sat in the top decade of the range. A corrupted value that still falls inside the range is never detected at all. The repair is also lossy in two ways: the consolidated table holds the corrected value and drops the flag, and the values no divisor could rescue are absent from it altogether. I would now store the raw value and a `repaired` column beside it, and keep the unrepairable readings in a table of their own. The audit report still counts the out-of-range values per file and parameter, so the evidence that they existed survives, but the readings themselves do not.

**Snapping to the grid.** Timestamps arrive with seconds and occasional minute drift, so 21:29:56 becomes 21:20:00 by truncation to the ten-minute slot. Two readings landing in one slot collapse under the unique index. Truncation assumes the drift runs late; a reading logged a few seconds early, like that one, belongs to the next slot and lands in the previous one instead, so rounding to the nearest slot would have been the safer rule. The snap runs before insert, which has a cost I only saw later: the export step detects each station's cadence from the stored minutes so that a fifteen-minute station gets a fifteen-minute grid. After the snap every station looks like a ten-minute station, so the few fifteen-minute stations are shifted by up to five minutes instead of being exported on their own grid. The general form of that mistake is normalizing a time axis before measuring its cadence.

The export is a grid and a pivot. The grid is every slot from the station's first reading to its last. The pivot turns the long table into one column per parameter, written here in the portable form (DuckDB also has a native `PIVOT` statement that does the same in one line). A left join of the grid on the pivot is the sheet the agency asked for, blanks included; run per station, it turns tens of millions of readings into thirteen workbooks.

```sql
-- the grid: one row per ten-minute slot from the station's first reading to its last
WITH bounds AS (
    SELECT MIN(ts) AS lo, MAX(ts) AS hi FROM readings WHERE station = ?
)
SELECT unnest(generate_series(lo, hi, INTERVAL '10 minutes')) AS ts
FROM bounds;

-- the pivot: one column per parameter, one row per slot with data
SELECT ts,
       MAX(CASE WHEN parameter = 'pH'   THEN value END) AS "pH",
       MAX(CASE WHEN parameter = 'COND' THEN value END) AS "COND",
       MAX(CASE WHEN parameter = 'DO'   THEN value END) AS "DO"
       -- one line per parameter
FROM readings
WHERE station = ?
GROUP BY ts;
```

---

## 6. Two Questions the Pipeline Could Not Answer

### When headers and data disagree

The content analyzer groups a station's workbooks by their set of parameters and flags any file whose header order differs from its siblings. Six workbooks from two stations had ammonium, phosphorus and orthophosphate in a different order. The question is whether the data moved with the headers or the headers were rotated over data that stayed put. A notebook compared each suspect column's mean against the station's historical profile for each of the three parameters and built a distance matrix; if the diagonal is not the minimum, label and data disagree. In all six files the diagonal was not the minimum, so label and data disagreed, but none of the distances was much above one standard deviation and the nearest matches did not reproduce any single rotation. The direction of the fix came instead from the column order: the data were taken to have stayed in their original positions while the headers rotated over them. The consolidation applies that as an explicit per-file mapping for the six files, in a table anyone can read, rather than a general rule that could misfire elsewhere. It remains a judgment made from distributions and column positions, and the guide documents it.

### Does the output match the input?

A validation script picks random timestamps per station, preferring rows with partial data because those are where joins go wrong, and reads the value from three places: the source file, the DuckDB table and the exported workbook. Every sample agreed, with two limitations. The script reads the source file with the same parser the pipeline used, so it proves the consolidation is consistent, not that the parser is right. It also looks the source row up by the timestamp already snapped to the grid, so for a reading the snap had moved it found no source row, and only database and workbook were compared.

---

## 7. The Anomaly That Was a Model Error

The largest cluster of severe discrepancies was one station's folder, call it station B. Its CSVs from several years carried a header code that the configuration mapped to station A, a name that appeared as a folder only in the first year of the archive. The configuration listed both, fourteen stations in all, one more than the agency operates. The cross-reference flagged 174 files, the exclusion rule kept them out of the consolidation, and station B's series began years later than its folder suggested, with only the recent workbooks.

The first fix was a special case: a whitelist saying that station A's code was acceptable in station B's folder, on the reading that the station had been renamed and its sensor had kept its code. That reading was right as far as it went, but the configuration still listed A and B as two stations and described the code as something B had inherited. The whitelist recovered most of that station's early series, and it produced the right numbers from a model that was still wrong.

A meeting with the agency supplied the fact the data could not. What the archive called station A in its first year and station B from the second year on was the same physical station, renamed after the river it sits on; the agency has a second station in the same municipality on another river.

There had never been fourteen stations, and the code had been that station's all along. The fix was a model change. The configuration gained one station with two historical aliases, the whitelist came out of the analyzer, which went back to exactly what it had been before the special case, and all but a handful of the 174 files stopped being discrepancies. Station B's consolidated series became continuous from the first year of the archive.

The detector had been right that the names disagreed and wrong about what the disagreement meant, and every relocation the fingerprint had proposed for that cluster was an answer to a malformed question.

---

## 8. What It Delivers

The audit report is one workbook with twelve tabs, from the file catalogue and the station-by-month coverage matrix to the identity discrepancies with the fingerprint's suggestion beside each, the duplicate groups and the out-of-range summaries. That workbook was the point of the whole exercise: the agency wanted evidence of what was missing and what was wrong, and every row in it names the file it came from.

The consolidation is one Excel workbook per station on the complete ten-minute grid, in the layout the agency specified. The DuckDB file the workbooks were generated from sits beside them, so any question the spreadsheets cannot answer can be asked in SQL.

The guide that accompanies both separates two kinds of decision:

- **Applied automatically:** lost-decimal repair within physical ranges, exclusion of files with severe identity discrepancies, duplicate resolution by row count, truncation to the ten-minute grid, and the six per-file column corrections
- **Pending confirmation:** every relocation the fingerprint suggested, and the milder discrepancies that were ingested as found

The last piece is the Streamlit app: a small chat interface over the DuckDB file, running a local open-weights code model that turns a question in Spanish into SQL, executes it and shows the result, with a chart when one fits. After a one-time model download it runs without network or account. It is a convenience for exploring the series, and no guarantee of the deliverable depends on it.

---

## 9. Lessons Learned

### Authority should scale with what a check rests on

The decimal repair ran unattended because a physical range bounds it and the rule fits in one line of the guide. The fingerprint stayed a suggestion because everything under it was softer: a confidence ratio that reads the same over one parameter as over ten, a coverage gap that was nearly guaranteed by the way the question was asked, and beneath both a station list with one station too many. A detector can be right about every comparison it makes and still be wrong when the list it compares against encodes a fact about the world that nobody has confirmed. That kind of fact belongs in configuration, where a conversation can change it.

### Keep the claims separate

Once a scanner resolves identity early, the disagreement that carries the signal is gone. The cross-reference in section 4 only existed because the catalogue had kept the claims side by side, and the fix in section 7 only needed configuration because the analyzer had never trusted any single one of them.

### Check the pipeline with something it did not produce

The sampling validator reads source files through the pipeline's own readers, so its agreement across three outputs could not have caught a parser fault. The parser faults were found by counting files that parsed as empty, and the coverage regression by comparing a run with the previous one. Each of those looks at the pipeline from outside, and an independent reader belongs in the validator too.

---

## Final Thoughts

This was a data project without a data product at the end. The deliverables are spreadsheets, a guide and a database file, and the value is that an archive whose reliability was unknown became evidence: every problem listed with the file it came from, and a clean series beside it whose every automatic correction is explained.

The idea I would keep is the separation between what the pipeline may decide and what it may only suggest. The pipeline repaired what physics constrains and refused to move a single file between stations, and the one time a mechanism produced confident relocation suggestions at scale, the largest cluster of them was wrong for a reason that was not in the data and came out only in a meeting with the agency.

If I were starting again, the readings table would keep raw values beside repaired ones, the fingerprint would refuse to rank stations on one parameter and would stop counting a near-automatic coverage gap as evidence, and the grid alignment would run after cadence detection instead of before it. The two-phase shape, audit first and consolidation second, would stay exactly as it was.

None of this is specific to river sensors. Whenever a pipeline has to infer a fact that lives in the world rather than in the data, where a device is installed, which customer owns an account, which asset a record belongs to, it can detect that the records contradict each other, and it cannot decide on its own which version is true.

---

**Thanks for reading. If you found this useful, feel free to share it with anyone whose pipeline has to decide which of two labels on a file to believe.**
