import { useLocale } from "vuetify";
import {
  actionMessageKey,
  humanizeAction,
  sourceMessageKey,
} from "../locales.js";

export function useOperationLabels() {
  const locale = useLocale();

  function actionLabel(action: string): string {
    const key = actionMessageKey(action);
    return key ? locale.t(key) : humanizeAction(action);
  }

  function sourceLabel(source: string): string {
    const key = sourceMessageKey(source);
    return key ? locale.t(key) : source;
  }

  return { actionLabel, sourceLabel };
}
