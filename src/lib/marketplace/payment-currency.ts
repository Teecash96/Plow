/**
 * The deployed BSC ERC 8183 kernels use United Stables as their payment
 * token. Keep provider quotes aligned with the token read on chain.
 */
export const BSC_ERC8183_PAYMENT_CURRENCY = "U" as const;

export function normalisePaymentCurrency(value: string | undefined) {
  return value?.trim().toUpperCase();
}

export function paymentCurrencyMatches(value: string | undefined, expected: string = BSC_ERC8183_PAYMENT_CURRENCY) {
  return normalisePaymentCurrency(value) === normalisePaymentCurrency(expected);
}
