# Runs the whole app (Bun server + built UI). The app starts the emulator as a sibling container, so the
# host Docker socket is mounted and the data dir must have the SAME absolute path inside and outside
# (see docker-compose.yml). Experimental: builds and boots the emulator; the browser can reach it with host networking on Linux, not on Docker Desktop for Mac.
FROM oven/bun:1-debian
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates docker-cli \
 && rm -rf /var/lib/apt/lists/* \
 && ARCH="$(uname -m)" \
 && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip" -o /tmp/awscli.zip \
 && unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscli.zip
WORKDIR /app
COPY bunfig.toml package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
ENV PORT=4747
EXPOSE 4747
CMD ["bun", "server/index.ts"]
