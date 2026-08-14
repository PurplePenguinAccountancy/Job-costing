import * as OTPAuth from "otpauth";

const ISSUER = "Wayleave";

/** A fresh base32 TOTP secret — encrypt with encryptSecret() before storing. */
export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/** The otpauth:// URI for QR-code enrollment (scan with Google Authenticator/Authy/etc). */
export function getProvisioningUri(secretBase32: string, email: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
  return totp.toString();
}

/**
 * true if the 6-digit code is valid for this secret right now. window: 1
 * tolerates one 30s step of clock drift either side — tight enough to stay
 * meaningful as a second factor, loose enough that a slightly-off phone
 * clock doesn't lock someone out.
 */
export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
  return totp.validate({ token: code, window: 1 }) !== null;
}
