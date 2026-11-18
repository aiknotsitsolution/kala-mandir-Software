import { Provider } from "react-redux";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAsync } from "./index";
import { queryApi } from "@/data/api/queryApi";
import { store } from "@/store";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
const sharedKey = "shared-query";

function QueryConsumer() {
    const query = useAsync(() => request(), [sharedKey]);
    return <span>{query.data?.value ?? "loading"}</span>;
}

describe("useAsync Redux query cache", () => {
    beforeEach(() => {
        request.mockReset().mockResolvedValue({ value: "cached result" });
        store.dispatch(queryApi.util.resetApiState());
    });

    afterEach(() => {
        cleanup();
        store.dispatch(queryApi.util.resetApiState());
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
});
