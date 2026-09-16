# Local campaign files

Campaign files use JSON. Seed files use JSONL with one object per line.

Simple CSV files also work when they contain a `url` or `source_url` column.
Quoted CSV fields are rejected. JSONL is the preferred format for complex seed data.

The campaign runner stores pages, leads, and exports under `var/local-leads`.
It never writes CRM or Neon data.
