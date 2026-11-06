# syntax=docker/dockerfile:1
# Overlay mixin: ships files/home/ into the agent's $HOME and the v2
# environment.variables as image ENV (merged into the composed image).
FROM busybox:1.37 AS build
COPY files/home/ /out/home/agent/
RUN chown -R 1000:1000 /out/home/agent

FROM scratch
COPY --from=build /out /
ENV IDADIR=/opt/ida-pro \
    IDA_NEXUS_IDALIB_ONLY=1 \
    OPENCODE_CONFIG_CONTENT='{"mcp":{"ida":{"type":"local","command":["uv","tool","run","--exclude-newer=1s","ida-mcp","stdio"],"environment":{"IDADIR":"/opt/ida-pro","IDA_NEXUS_IDALIB_ONLY":"1"},"enabled":true}}}'
