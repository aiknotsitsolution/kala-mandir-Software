import test from "node:test";
import assert from "node:assert/strict";
import { renderBrandedEmail } from "../src/services/email.js";

test("renders a branded OTP email in HTML and plain text", () => {
  const message = renderBrandedEmail({
    preheader: "Sign-in code",
    eyebrow: "Secure sign-in",
    title: "Verify your email",
    greeting: "Asha",
    message: "Use this code to sign in.",
    otpCode: "012345",
    note: "Expires in one minute.",
  });

  assert.match(message.html, /KALA MANDIR/);
  assert.match(message.html, /letter-spacing:9px/);
  assert.match(message.html, /012345/);
  assert.match(message.text, /Your verification code: 012345/);
  assert.match(message.text, /Expires in one minute/);
});

test("escapes dynamic details and formats a secure action link", () => {
  const message = renderBrandedEmail({
    preheader: "Student portal",
    eyebrow: "Student portal",
    title: "Registration verified",
    greeting: "<script>alert(1)</script>",
    message: "Choose your password.",
    details: [{ label: "Student ID", value: "<b>123</b>" }],
    action: { label: "Set password", url: "https://example.test/set-password?a=1&b=2" },
  });

  assert.match(message.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(message.html, /&lt;b&gt;123&lt;\/b&gt;/);
  assert.match(message.html, /href="https:\/\/example\.test\/set-password\?a=1&amp;b=2"/);
  assert.match(message.text, /Student ID: <b>123<\/b>/);
});
