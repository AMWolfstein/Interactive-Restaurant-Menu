import { createECDH, randomBytes } from "node:crypto";
import { IncomingMessage } from "node:http";
import https from "node:https";
import { Socket } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { generateVAPIDKeys } from "web-push";
import { sendPushNotification } from "../lib/push-notifications";

const { list, remove } = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../lib/push-store", () => ({
  listPushSubscriptions: list,
  removePushSubscription: remove,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("sends encrypted Web Push payloads and removes expired subscriptions", async () => {
  const vapid = generateVAPIDKeys();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", vapid.publicKey);
  vi.stubEnv("VAPID_PRIVATE_KEY", vapid.privateKey);
  vi.stubEnv("VAPID_SUBJECT", "mailto:owner@example.com");

  const keys = {
    p256dh: createECDH("prime256v1").generateKeys().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
  const active = "https://push.example.com/active";
  const expired = "https://push.example.com/expired";
  list.mockResolvedValue([{ endpoint: active, keys }, { endpoint: expired, keys }]);
  remove.mockResolvedValue(undefined);

  const write = vi.fn();
  const mockRequest = (options: https.RequestOptions, onResponse: (response: IncomingMessage) => void) => ({
    on: vi.fn(),
    write,
    end() {
      const response = new IncomingMessage(new Socket());
      response.statusCode = options.path === "/expired" ? 410 : 201;
      onResponse(response);
      response.emit("end");
    },
  });
  const request = vi.spyOn(https, "request")
    .mockImplementation(mockRequest as unknown as typeof https.request);

  await expect(sendPushNotification({ title: "New offer", body: "Today's offer" }))
    .resolves.toEqual({ sent: 1, removed: 1 });
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    method: "POST",
    path: "/active",
    headers: expect.objectContaining({
      Authorization: expect.stringMatching(/^vapid /),
      "Content-Encoding": "aes128gcm",
      TTL: 43200,
    }),
  }), expect.any(Function));
  expect(write).toHaveBeenCalledWith(expect.any(Buffer));
  expect(remove).toHaveBeenCalledExactlyOnceWith(expired);
});
