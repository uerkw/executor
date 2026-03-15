const stableVersionPattern = /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$/;
const betaVersionPattern =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)-beta\.(?<beta>0|[1-9]\d*)$/;

export const resolveNextBetaVersion = (version: string): string => {
  const betaMatch = version.match(betaVersionPattern);
  if (betaMatch?.groups) {
    const { major, minor, patch, beta } = betaMatch.groups;

    return `${major}.${minor}.${patch}-beta.${Number(beta) + 1}`;
  }

  const stableMatch = version.match(stableVersionPattern);
  if (stableMatch?.groups) {
    const { major, minor, patch } = stableMatch.groups;

    return `${major}.${minor}.${Number(patch) + 1}-beta.0`;
  }

  throw new Error(
    [
      `Unsupported version for automatic beta release: ${version}`,
      "Expected a stable version like 1.2.3 or an existing beta like 1.2.4-beta.0.",
    ].join("\n"),
  );
};
