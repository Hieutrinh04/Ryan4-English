import assert from "node:assert/strict";
import test from "node:test";
import {
  authErrorMessage,
  cleanDisplayName,
  initialsFor,
  normalizeEmail,
  passwordStrength,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from "../lib/auth.mjs";

test("normalizes and validates registration fields", () => {
  assert.equal(normalizeEmail("  Ryan@Example.COM "), "ryan@example.com");
  assert.equal(validateEmail("ryan@example.com"), "");
  assert.match(validateEmail("ryan.example.com"), /chưa đúng định dạng/);
  assert.equal(cleanDisplayName("  Ryan   Nguyễn < > "), "Ryan Nguyễn");
  assert.equal(validateDisplayName("R"), "Tên hiển thị cần ít nhất 2 ký tự.");
});

test("checks password confirmation and reports strength", () => {
  assert.match(validatePassword("short", "short"), /ít nhất 8/);
  assert.equal(validatePassword("learning12", "different"), "Hai ô mật khẩu chưa khớp.");
  assert.equal(validatePassword("learning12!", "learning12!"), "");
  assert.deepEqual(passwordStrength("learning12!"), { score: 3, label: "Mạnh" });
});

test("translates common Supabase authentication errors", () => {
  assert.equal(authErrorMessage({ message: "Invalid login credentials" }), "Email hoặc mật khẩu không đúng.");
  assert.match(authErrorMessage({ code: "email_not_confirmed" }), /chưa được xác nhận/);
  assert.match(authErrorMessage({ code: "over_email_send_rate_limit" }), /thao tác quá nhanh/);
  assert.match(authErrorMessage({ code: "otp_expired" }), /hết hạn/);
  assert.match(authErrorMessage({ message: "Signups not allowed for otp" }), /đăng ký trước/);
  assert.equal(authErrorMessage(new Error("unexpected")), "Không thể hoàn tất thao tác. Vui lòng thử lại.");
});

test("builds account initials from name or email", () => {
  assert.equal(initialsFor("Ryan Nguyễn", ""), "RN");
  assert.equal(initialsFor("", "student@example.com"), "ST");
});
