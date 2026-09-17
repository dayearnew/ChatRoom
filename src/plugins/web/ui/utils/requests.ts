import { getCurrentScope, onScopeDispose } from "vue";

interface RequestToken {
  generation: number;
  signal: AbortSignal;
}

interface RequestGate {
  begin(): RequestToken;
  isCurrent(token: RequestToken): boolean;
  invalidate(): void;
}

export function createRequestGate(): RequestGate {
  let generation = 0;
  let controller: AbortController | null = null;

  const gate: RequestGate = {
    begin() {
      controller?.abort();
      controller = new AbortController();
      return { generation: ++generation, signal: controller.signal };
    },
    isCurrent(token) {
      return token.generation === generation && !token.signal.aborted;
    },
    invalidate() {
      generation += 1;
      controller?.abort();
      controller = null;
    },
  };

  if (getCurrentScope()) onScopeDispose(gate.invalidate);
  return gate;
}
