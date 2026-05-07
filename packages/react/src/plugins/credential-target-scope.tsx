import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { ScopeId } from "@executor-js/sdk";

import { useScope, useUserScope } from "../api/scope-context";
import {
  CardStack,
  CardStackContent,
  CardStackEntry,
  CardStackEntryContent,
  CardStackEntryDescription,
  CardStackEntryTitle,
} from "../components/card-stack";
import { FilterTabs } from "../components/filter-tabs";

export interface CredentialTargetScopeOption {
  readonly scopeId: ScopeId;
  readonly label: string;
  readonly description: string;
}

export const credentialTargetScopeOptions = (input: {
  readonly sourceScope: ScopeId;
  readonly userScope: ScopeId;
  readonly sourceScopeLabel?: string;
}): readonly CredentialTargetScopeOption[] => {
  if (input.sourceScope === input.userScope) {
    return [
      {
        scopeId: input.userScope,
        label: "Personal",
        description: "Saved only for your account.",
      },
    ];
  }

  return [
    {
      scopeId: input.userScope,
      label: "Personal",
      description: "Saved only for your account.",
    },
    {
      scopeId: input.sourceScope,
      label: input.sourceScopeLabel ?? "Organization",
      description: "Shared with everyone who can use this source.",
    },
  ];
};

export const normalizeCredentialTargetScope = (
  value: ScopeId,
  options: readonly CredentialTargetScopeOption[],
): ScopeId => options.find((option) => option.scopeId === value)?.scopeId ?? options[0]!.scopeId;

export function useCredentialTargetScope(input?: {
  readonly sourceScope?: ScopeId;
  readonly sourceScopeLabel?: string;
  readonly initialTargetScope?: ScopeId;
}): {
  readonly credentialTargetScope: ScopeId;
  readonly setCredentialTargetScope: (scope: ScopeId) => void;
  readonly credentialScopeOptions: readonly CredentialTargetScopeOption[];
} {
  const routeScope = useScope();
  const sourceScope = input?.sourceScope ?? routeScope;
  const userScope = useUserScope();
  const credentialScopeOptions = useMemo(
    () =>
      credentialTargetScopeOptions({
        sourceScope,
        userScope,
        sourceScopeLabel: input?.sourceScopeLabel,
      }),
    [sourceScope, userScope, input?.sourceScopeLabel],
  );
  const initialTargetScope = input?.initialTargetScope ?? credentialScopeOptions[0]!.scopeId;
  const [credentialTargetScope, setCredentialTargetScope] = useState<ScopeId>(
    normalizeCredentialTargetScope(initialTargetScope, credentialScopeOptions),
  );

  useEffect(() => {
    setCredentialTargetScope((current) =>
      normalizeCredentialTargetScope(
        current === routeScope && input?.sourceScope !== undefined ? initialTargetScope : current,
        credentialScopeOptions,
      ),
    );
  }, [credentialScopeOptions, initialTargetScope, input?.sourceScope, routeScope]);

  return {
    credentialTargetScope,
    setCredentialTargetScope,
    credentialScopeOptions,
  };
}

export function CredentialTargetScopeSelector(props: {
  readonly value: ScopeId;
  readonly options: readonly CredentialTargetScopeOption[];
  readonly onChange: (scope: ScopeId) => void;
  readonly title?: string;
  readonly description?: string;
}) {
  if (props.options.length <= 1) return null;

  const active = props.options.find((option) => option.scopeId === props.value);

  return (
    <CardStack>
      <CardStackContent className="border-t-0">
        <CardStackEntry>
          <CardStackEntryContent>
            <CardStackEntryTitle>{props.title ?? "Credentials"}</CardStackEntryTitle>
            <CardStackEntryDescription>
              {props.description ??
                active?.description ??
                "Choose where new credentials are saved."}
            </CardStackEntryDescription>
          </CardStackEntryContent>
          <FilterTabs<ScopeId>
            tabs={props.options.map((option) => ({
              value: option.scopeId,
              label: option.label,
            }))}
            value={props.value}
            onChange={props.onChange}
          />
        </CardStackEntry>
      </CardStackContent>
    </CardStack>
  );
}

export function CredentialScopeSection(props: {
  readonly value: ScopeId;
  readonly options: readonly CredentialTargetScopeOption[];
  readonly onChange: (scope: ScopeId) => void;
  readonly children: ReactNode;
  readonly title?: string;
  readonly description?: string;
}) {
  return (
    <div className="space-y-3">
      <CredentialTargetScopeSelector
        value={props.value}
        options={props.options}
        onChange={props.onChange}
        title={props.title ?? "Save credentials to"}
        description={props.description ?? "Choose who can use the credentials attached below."}
      />
      {props.children}
    </div>
  );
}
