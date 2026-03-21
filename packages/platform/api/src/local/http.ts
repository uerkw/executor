import { HttpApiBuilder } from "@effect/platform";
import {
  createLocalSecret,
  deleteLocalSecret,
  getLocalInstanceConfig,
  getLocalInstallation,
  listLocalSecrets,
  updateLocalSecret,
} from "@executor/platform-sdk";

import { ControlPlaneApi } from "../api";

export const ControlPlaneLocalLive = HttpApiBuilder.group(
  ControlPlaneApi,
  "local",
  (handlers) =>
    handlers
      .handle("installation", () => getLocalInstallation())
      .handle("config", () => getLocalInstanceConfig())
      .handle("listSecrets", () => listLocalSecrets())
      .handle("createSecret", ({ payload }) => createLocalSecret(payload))
      .handle("updateSecret", ({ path, payload }) =>
        updateLocalSecret({
          secretId: path.secretId,
          payload,
        }),
      )
      .handle("deleteSecret", ({ path }) => deleteLocalSecret(path.secretId)),
);
