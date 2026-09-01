#!/usr/bin/env python3
"""Exact replay-only C6.0.1.14.5 Unit/realization planner.

The caller supplies frozen machine geometry only.  This module performs a
sequence of integer solves, fixing each optimum before moving to the next
lexicographic objective.  It never opens media, caches, subtitles, or Gold.
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix


def union(intervals):
    rows = sorted((int(a), int(b)) for a, b in intervals if int(b) > int(a))
    out = []
    for start, end in rows:
        if not out or start > out[-1][1]:
            out.append([start, end])
        else:
            out[-1][1] = max(out[-1][1], end)
    return out


def interval_samples(intervals):
    return sum(end - start for start, end in union(intervals))


def elementary_segments(bundle_rows, immutable, field):
    immutable_union = union(immutable)
    endpoints = {point for row in immutable_union for point in row}
    for bundle in bundle_rows:
        for start, end in bundle[field]:
            endpoints.add(int(start))
            endpoints.add(int(end))
    ordered = sorted(endpoints)
    segments = []
    for start, end in zip(ordered, ordered[1:]):
        if end <= start:
            continue
        if any(a <= start and end <= b for a, b in immutable_union):
            continue
        covering = [
            index
            for index, bundle in enumerate(bundle_rows)
            if any(a <= start and end <= b for a, b in bundle[field])
        ]
        if covering:
            segments.append((start, end, covering))
    return segments


def main():
    payload = json.load(sys.stdin)
    bundles = payload["bundles"]
    units = payload["units"]
    realizations = payload["realizations"]
    required_children = set(payload["requiredChildIds"])
    all_children = payload["allChildIds"]

    names = []
    variable_groups = {}

    def allocate(group, ids):
        mapping = {}
        for item_id in ids:
            mapping[item_id] = len(names)
            names.append(f"{group}:{item_id}")
        variable_groups[group] = mapping
        return mapping

    x = allocate("bundle", [row["bundleId"] for row in bundles])
    z = allocate("realization", [row["realizationId"] for row in realizations])
    u = allocate("unit", [row["coverageUnitId"] for row in units])

    families = sorted({value for row in units for value in row["families"]})
    strata = sorted({value for row in units for value in row["strata"]})
    diversity = sorted(
        {f"timeline:{value}" for row in units for value in row["timelineBins"]}
        | {f"scene:{value}" for row in units for value in row["sceneIds"]}
    )
    family_vars = allocate("family", families)
    stratum_vars = allocate("stratum", strata)
    diversity_vars = allocate("diversity", diversity)

    immutable_audio = [tuple(row) for row in payload["immutableAudioIntervals"]]
    audio_segments = elementary_segments(bundles, immutable_audio, "audioIntervals")
    silence_segments = elementary_segments(bundles, [], "silenceIntervals")
    audio_vars = allocate("audio", [str(index) for index in range(len(audio_segments))])
    silence_vars = allocate(
        "silence", [str(index) for index in range(len(silence_segments))]
    )

    lower = []
    upper = []
    constraint_rows = []

    def add(coefficients, low=-math.inf, high=math.inf):
        constraint_rows.append(coefficients)
        lower.append(low)
        upper.append(high)

    bundles_by_child = defaultdict(list)
    for bundle in bundles:
        for child_id in bundle["childIds"]:
            bundles_by_child[child_id].append(bundle["bundleId"])
    for child_id in all_children:
        coefficients = {x[bundle_id]: 1 for bundle_id in bundles_by_child[child_id]}
        if child_id in required_children:
            add(coefficients, 1, 1)
        else:
            add(coefficients, 0, 1)

    add({index: 1 for index in x.values()}, 0, payload["maximumBundles"])
    add(
        {
            x[row["bundleId"]]: int(row["coreSamples"])
            for row in bundles
        },
        0,
        payload["maximumCoreSamples"],
    )

    realization_by_unit = defaultdict(list)
    for row in realizations:
        realization_by_unit[row["coverageUnitId"]].append(row["realizationId"])
        realization_index = z[row["realizationId"]]
        bundle_indices = [x[bundle_id] for bundle_id in row["bundleIds"]]
        for bundle_index in bundle_indices:
            add({realization_index: 1, bundle_index: -1}, -math.inf, 0)
        coefficients = {realization_index: 1}
        for bundle_index in bundle_indices:
            coefficients[bundle_index] = coefficients.get(bundle_index, 0) - 1
        add(coefficients, 1 - len(bundle_indices), math.inf)

    for row in units:
        unit_index = u[row["coverageUnitId"]]
        realization_ids = realization_by_unit[row["coverageUnitId"]]
        coefficients = {unit_index: 1}
        for realization_id in realization_ids:
            coefficients[z[realization_id]] = -1
            add({z[realization_id]: 1, unit_index: -1}, -math.inf, 0)
        add(coefficients, -math.inf, 0)

    def bind_or(feature_vars, feature_getter):
        for feature, variable_index in feature_vars.items():
            member_units = [
                row["coverageUnitId"]
                for row in units
                if feature in feature_getter(row)
            ]
            coefficients = {variable_index: 1}
            for unit_id in member_units:
                coefficients[u[unit_id]] = -1
                add({u[unit_id]: 1, variable_index: -1}, -math.inf, 0)
            add(coefficients, -math.inf, 0)

    bind_or(family_vars, lambda row: row["families"])
    bind_or(stratum_vars, lambda row: row["strata"])
    bind_or(
        diversity_vars,
        lambda row: [f"timeline:{value}" for value in row["timelineBins"]]
        + [f"scene:{value}" for value in row["sceneIds"]],
    )

    for segment_index, (_, _, covering) in enumerate(audio_segments):
        variable_index = audio_vars[str(segment_index)]
        for bundle_index in covering:
            add({x[bundles[bundle_index]["bundleId"]]: 1, variable_index: -1}, -math.inf, 0)
        coefficients = {variable_index: 1}
        for bundle_index in covering:
            coefficients[x[bundles[bundle_index]["bundleId"]]] = -1
        add(coefficients, -math.inf, 0)

    immutable_audio_samples = interval_samples(immutable_audio)
    add(
        {
            audio_vars[str(index)]: end - start
            for index, (start, end, _) in enumerate(audio_segments)
        },
        0,
        payload["maximumAudioSamples"] - immutable_audio_samples,
    )

    for segment_index, (_, _, covering) in enumerate(silence_segments):
        variable_index = silence_vars[str(segment_index)]
        for bundle_index in covering:
            add({x[bundles[bundle_index]["bundleId"]]: 1, variable_index: -1}, -math.inf, 0)
        coefficients = {variable_index: 1}
        for bundle_index in covering:
            coefficients[x[bundles[bundle_index]["bundleId"]]] = -1
        add(coefficients, -math.inf, 0)

    forced_ids = payload.get("forcedRealizationIds", [])
    if forced_ids:
        add({z[realization_id]: 1 for realization_id in forced_ids}, 1, math.inf)

    objectives = []

    def unit_objective(predicate, getter=lambda row: 1):
        return {
            u[row["coverageUnitId"]]: int(getter(row))
            for row in units
            if predicate(row)
        }

    objectives.append((unit_objective(lambda row: row["tier"] == "UNIT_TIER_5_MULTI_FAMILY_VERIFIED"), True))
    objectives.append((unit_objective(lambda row: row["tier"] == "UNIT_TIER_4_INDEPENDENT_EXCLUSIVE_VERIFIED"), True))
    objectives.append((unit_objective(lambda row: row["tier"] == "UNIT_TIER_3_SINGLE_FAMILY_VERIFIED"), True))
    objectives.append((unit_objective(lambda row: True, lambda row: row["durationUtility"]), True))
    objectives.append(({index: 1 for index in family_vars.values()}, True))
    objectives.append(({index: 1 for index in stratum_vars.values()}, True))
    objectives.append(({index: 1 for index in diversity_vars.values()}, True))
    objectives.append((unit_objective(lambda row: True, lambda row: row["textUtility"]), True))
    objectives.append((unit_objective(lambda row: row["tier"] in ["UNIT_TIER_2_MASKED_OR_SUBTHRESHOLD", "UNIT_TIER_1_AUDIT_ONLY"]), True))
    objectives.append(({index: 1 for index in x.values()}, False))
    objectives.append(({x[row["bundleId"]]: int(row["coreSamples"]) for row in bundles}, False))
    objectives.append(({
        audio_vars[str(index)]: end - start
        for index, (start, end, _) in enumerate(audio_segments)
    }, False))
    objectives.append(({
        silence_vars[str(index)]: end - start
        for index, (start, end, _) in enumerate(silence_segments)
    }, False))
    ordered_bundles = sorted(
        bundles, key=lambda row: (row["startSample"], row["bundleId"])
    )
    objectives.append(({
        x[row["bundleId"]]: index + 1
        for index, row in enumerate(ordered_bundles)
    }, False))

    def constraints():
        row_indices = []
        column_indices = []
        values = []
        for row_index, coefficients in enumerate(constraint_rows):
            for column_index, value in coefficients.items():
                if value:
                    row_indices.append(row_index)
                    column_indices.append(column_index)
                    values.append(value)
        matrix = coo_matrix(
            (values, (row_indices, column_indices)),
            shape=(len(constraint_rows), len(names)),
        ).tocsr()
        return LinearConstraint(matrix, np.array(lower), np.array(upper))

    solution = None
    objective_values = []
    explored_nodes = 0
    for coefficients, maximize in objectives:
        if not coefficients:
            objective_values.append(0)
            continue
        c = np.zeros(len(names))
        for variable_index, value in coefficients.items():
            c[variable_index] = -value if maximize else value
        result = milp(
            c,
            integrality=np.ones(len(names)),
            bounds=Bounds(np.zeros(len(names)), np.ones(len(names))),
            constraints=constraints(),
            options={"mip_rel_gap": 0.0, "presolve": True},
        )
        explored_nodes += int(getattr(result, "mip_node_count", 0) or 0)
        if result.status == 2:
            print(json.dumps({"status": "INFEASIBLE_PROVEN", "exploredNodes": explored_nodes}))
            return
        if result.status != 0 or result.x is None:
            print(json.dumps({"status": "SEARCH_INCOMPLETE", "message": result.message, "exploredNodes": explored_nodes}))
            return
        solution = result.x
        optimum = int(round(sum(value * solution[index] for index, value in coefficients.items())))
        objective_values.append(optimum if maximize else -optimum)
        add(coefficients, optimum, optimum)

    assert solution is not None
    selected_bundles = [
        bundle_id for bundle_id, index in x.items() if solution[index] > 0.5
    ]
    selected_realizations = [
        realization_id
        for realization_id, index in z.items()
        if solution[index] > 0.5
    ]
    selected_units = [
        unit_id for unit_id, index in u.items() if solution[index] > 0.5
    ]
    print(
        json.dumps(
            {
                "status": "OPTIMAL",
                "selectedBundleIds": selected_bundles,
                "selectedRealizationIds": selected_realizations,
                "selectedCoverageUnitIds": selected_units,
                "objectiveValues": objective_values,
                "exploredNodes": explored_nodes,
                "solver": "SCIPY_HIGHS_LEXICOGRAPHIC_MILP_V1",
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
