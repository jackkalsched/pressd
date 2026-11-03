"""Weighted alternating least squares over the taste matrix (`backend/taste_matrix.py`).

The nightly job fits item factors on the whole userbase; the web service later folds a
user into them (`backend/taste_overlap.fold_in`). The user step here solves exactly the
system `fold_in` solves (same ridge, item bias subtracted, no user bias), and the fit
ends on a user step, so a fold-in against the fitted items reproduces the fitted user
vector exactly.

The item step fits a bias and a vector jointly, and the bias has its own ridge
(`bias_reg`). Most columns have two or three raters. Left free, a two-rater column's
bias lands on the pair's mean, the residuals become ±(za − zb)/2, mirror images, and
the vectors learn opposite directions for two people who agree: on real data a pair
sharing 47 songs at z correlation +0.62 came out at cosine −0.995. The z-scored cells
already centre every column near 0, so shrinking the bias toward 0 costs little and
leaves the agreement in the residuals, where the vectors can see it. A column only one
user rated is fitted like any other; the ridges keep it near zero.

This module is fit only. It touches no database. numpy is fine here (worker only);
results are stored as plain lists so the stdlib web service can read them.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from backend.taste_matrix import Cells
from backend.taste_overlap import REG, RANK, Item


@dataclass
class Model:
    items: dict[str, Item]
    users: dict[int, list[float]]
    rank: int
    reg: float


def fit(cells: dict[int, Cells], rank: int = RANK, reg: float = REG,
        iters: int = 15, seed: int = 7, bias_reg: float | None = None) -> Model:
    """`bias_reg` is the item bias's ridge; it defaults to `reg`."""
    bias_reg = reg if bias_reg is None else bias_reg
    uids = sorted(cells)
    keys = sorted({k for c in cells.values() for k in c})
    kidx = {k: i for i, k in enumerate(keys)}
    # Per-user and per-column observation lists as (other index, z, weight).
    by_user = [[(kidx[k], z, w) for k, (z, w) in cells[u].items()] for u in uids]
    by_item: list[list[tuple[int, float, float]]] = [[] for _ in keys]
    for ui, obs in enumerate(by_user):
        for ki, z, w in obs:
            by_item[ki].append((ui, z, w))

    rng = np.random.default_rng(seed)
    V = rng.normal(0.0, 0.1, (len(keys), rank))
    bias = np.zeros(len(keys))
    U = np.zeros((len(uids), rank))
    eye = np.eye(rank)
    ridge1 = np.diag([reg] * rank + [bias_reg])     # the vector's ridge, then the bias's

    def user_step() -> None:
        for ui, obs in enumerate(by_user):
            if not obs:
                continue
            idx = np.array([o[0] for o in obs])
            z = np.array([o[1] for o in obs])
            w = np.array([o[2] for o in obs])
            Vi = V[idx]
            A = (Vi * w[:, None]).T @ Vi + reg * eye
            U[ui] = np.linalg.solve(A, (Vi * (w * (z - bias[idx]))[:, None]).sum(axis=0))

    for _ in range(iters):
        user_step()
        for ki, obs in enumerate(by_item):
            if not obs:
                continue
            idx = np.array([o[0] for o in obs])
            z = np.array([o[1] for o in obs])
            w = np.array([o[2] for o in obs])
            X = np.hstack([U[idx], np.ones((len(idx), 1))])
            A = (X * w[:, None]).T @ X + ridge1
            # With bias_reg 0 the bias row can be singular when the vector part is
            # idle; a tiny jitter keeps the solve defined without moving the result.
            A += 1e-9 * np.eye(rank + 1)
            sol = np.linalg.solve(A, (X * (w * z)[:, None]).sum(axis=0))
            V[ki], bias[ki] = sol[:rank], sol[rank]
    user_step()     # last, so each user is exactly the fold-in against the final items

    return Model(
        items={k: Item(float(bias[i]), V[i].tolist()) for k, i in kidx.items()},
        users={u: U[i].tolist() for i, u in enumerate(uids)},
        rank=rank,
        reg=reg,
    )
