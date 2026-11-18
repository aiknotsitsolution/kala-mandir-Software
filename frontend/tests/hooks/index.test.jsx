import { Provider } from "react-redux";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAsync } from "@/hooks";
import { queryApi } from "@/data/api/queryApi";
import { store } from "@/store";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
const sharedKey = "shared-query";

function QueryConsumer({ enabled = true, pollingInterval = 0 }) {
    const query = useAsync(() => request(), [sharedKey], { enabled, pollingInterval });
    return (
      <>
        <span data-testid="query-state">{query.status}</span>
        <span>{query.data?.value ?? "loading"}</span>
      </>
    );
}

describe("useAsync Redux query cache", () => {
    beforeEach(() => {
        request.mockReset().mockResolvedValue({ value: "cached result" });
        store.dispatch(queryApi.util.resetApiState());
    });

    afterEach(() => {
        cleanup();
        store.dispatch(queryApi.util.resetApiState());
        vi.useRealTimers();
    });

    it("deduplicates the same active request across consumers", async () => {
        render(
          <Provider store={store}>
            <QueryConsumer />
            <QueryConsumer />
          </Provider>,
        );

        expect(await screen.findAllByText("cached result")).toHaveLength(2);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it("reports idle while disabled, then loading and succeeded when enabled", async () => {
        let resolveRequest;
        request.mockImplementation(() => new Promise((resolve) => {
            resolveRequest = resolve;
        }));
        const { rerender } = render(
          <Provider store={store}>
            <QueryConsumer enabled={false} />
          </Provider>,
        );

        expect(screen.getByTestId("query-state")).toHaveTextContent("idle");
        expect(request).not.toHaveBeenCalled();

        rerender(
          <Provider store={store}>
            <QueryConsumer />
          </Provider>,
        );
        expect(screen.getByTestId("query-state")).toHaveTextContent("loading");

        await act(async () => resolveRequest({ value: "loaded" }));
        await waitFor(() => expect(screen.getByTestId("query-state")).toHaveTextContent("succeeded"));
    });

    it("reports failed when the request rejects", async () => {
        request.mockRejectedValue(new Error("network down"));
        render(
          <Provider store={store}>
            <QueryConsumer />
          </Provider>,
        );

        await waitFor(() => expect(screen.getByTestId("query-state")).toHaveTextContent("failed"));
    });

    it("polls at the configured interval", async () => {
        vi.useFakeTimers();
        render(
          <Provider store={store}>
            <QueryConsumer pollingInterval={1_000} />
          </Provider>,
        );

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(request).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
        });
        expect(request).toHaveBeenCalledTimes(2);
    });
});
