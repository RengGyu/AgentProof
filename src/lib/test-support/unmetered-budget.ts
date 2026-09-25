/** Only for pre-existing provider/evidence unit fixtures. Budget boundary tests
 * use the real module and durable SQL; this helper is never imported by runtime. */
export const unmeteredBudgetFixture = {
  withPaidAnalysis: async <T>(_key: string, work: () => Promise<T>) => work(),
  paidProviderCall: async <T>(options: {invoke:(signal:AbortSignal)=>Promise<T>}) => options.invoke(new AbortController().signal),
  budgetedOpenAIFetch: (url:string,init:RequestInit,fetchFn:typeof fetch=fetch) => fetchFn(url,init)
};
