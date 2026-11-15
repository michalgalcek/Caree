// Shop plans. Limits apply identically in ChatGPT, on the tablet and on the web (feature parity).
// Plans are sold and changed only on the Garagee website – never inside ChatGPT.
export const PLANS = {
  start: { name: 'Start', vehicles: 100, users: 1 },
  profi: { name: 'Profi', vehicles: 2000, users: 5 },
  workshop: { name: 'Workshop+', vehicles: null, users: null },
  unlimited: { name: 'Unlimited (internal / review)', vehicles: null, users: null },
};
export const DEFAULT_PLAN = 'start';
export function planOf(code) { return PLANS[code] ? { code, ...PLANS[code] } : { code: DEFAULT_PLAN, ...PLANS[DEFAULT_PLAN] }; }
