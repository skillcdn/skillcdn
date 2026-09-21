import type { ApiError } from "../api/client.js";
import { useI18n } from "../i18n/index.js";
import type { Messages } from "../i18n/messages/en.js";
import { Button, Callout } from "./ui.js";

type KnownErrorCode = keyof Messages["errors"]["codes"];

/** What to tell a person about a failed request, in their language. */
export function describeError(
  t: Messages,
  error: ApiError,
): { readonly title: string; readonly body: string } {
  if (error.code in t.errors.codes) {
    return t.errors.codes[error.code as KnownErrorCode];
  }
  return {
    title: t.errors.title,
    body: error.code === "network" ? t.errors.network : t.errors.generic,
  };
}

export function ErrorCallout(props: { readonly error: ApiError; readonly onRetry?: () => void }) {
  const { t } = useI18n();
  const { title, body } = describeError(t, props.error);
  // A server that is not there, or is struggling, may be back in a moment. A missing thing is not.
  const retryable = props.error.status === 0 || props.error.status >= 500;
  return (
    <Callout
      tone="danger"
      title={title}
      action={
        retryable && props.onRetry !== undefined ? (
          <Button size="sm" onClick={props.onRetry}>
            {t.common.retry}
          </Button>
        ) : undefined
      }
    >
      {body}
    </Callout>
  );
}
