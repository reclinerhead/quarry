"""Jasper: the Quarry's worker.

Jasper owns the database schema, drains the identification queue, and is the
only process that calls a model (#7). Phase 2 adds the Mindat enrichment. The
web app (web/) reads and writes the same SQLite file but never creates tables.
"""
