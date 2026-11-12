# Agent Instructions for demo-data

This directory contains demo datasets for Refract. It was consolidated from the
now-deleted `refract-org/refract-demo-data` repository.

- All content must be from public wikis or obviously fictional (synthetic healthcare).
- Never add real PII, real medical records, or proprietary data.
- JSONL files use newline-delimited JSON with optional header comment lines starting with `#`. `refract_eval` skips those lines; the viewer reports each as an invalid line and loads the rest; other JSON Lines readers need them removed.
