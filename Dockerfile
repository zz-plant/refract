# Built from this checkout, not installed from npm. The image is built on the
# same tag push that publishes to npm, so `bun install -g @refract-org/cli`
# raced the publish and got whatever npm already had — 0.5.7, which cannot
# start — and the image never contained the tagged code.
FROM oven/bun:1.4.4
WORKDIR /opt/refract
COPY . .
RUN bun install --frozen-lockfile && bun run build
ENTRYPOINT ["bun", "/opt/refract/packages/cli/dist/src/cli.js"]
CMD ["analyze", "Bitcoin", "--depth", "brief"]
