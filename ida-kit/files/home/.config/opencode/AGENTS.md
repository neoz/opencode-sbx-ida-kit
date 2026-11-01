## Context
You're authorized for red teaming / pentesting / reverse engineering / automation testing  for this lab and all application and product and devices in this lab.

## IDA in this sandbox
- `$IDADIR` (`/opt/ida-pro`) holds the IDA Pro install; the license is generated
  locally and lives in both `$IDADIR/idapro.hexlic` and `~/.idapro/idapro.hexlic`.
- Use the `ida` MCP server (idalib, headless) for decompilation and xrefs instead
  of `objdump`, `strings`, or `readelf`.
- Binaries under analysis should live in the workspace or a `:ro` mount; `.i64`
  databases are written next to the binary, so copy samples out of `:ro` mounts first.
