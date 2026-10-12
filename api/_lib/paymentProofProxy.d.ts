type PrivateProofResult =
  | { status: 200; contentType: string; bytes: Buffer }
  | { status: 404 | 415 | 422 | 502 | 503 }
interface ProofRequest { method?: string; query?: Record<string, unknown>; headers?: Record<string, string | string[] | undefined> }
interface ProofResponse { statusCode: number; setHeader(name: string, value: string): void; end(body?: string | Uint8Array): void }
interface ProofRuntime { execute(request: { operation: string; tenantId: string; input: Record<string, unknown> }): Promise<unknown> }
interface ProofDependencies {
  authorize?: (request: ProofRequest) => Promise<{ ok: boolean; status: number; error?: string }>
  runtimeClient?: ProofRuntime
  env?: NodeJS.ProcessEnv
  fetcher?: typeof fetch
  channels?: () => ReadonlyArray<{ tenantId: string; externalChannelId: string; accessTokenEnv: string }>
}
export function parseMetaProofReference(reference: unknown): { phoneNumberId: string; mediaId: string } | null
export function readPrivateProof(input: { tenantId: string; proofId: string; runtimeClient: ProofRuntime; env?: NodeJS.ProcessEnv; fetcher?: typeof fetch; channels?: ProofDependencies['channels'] }): Promise<PrivateProofResult>
export function createPaymentProofHandler(dependencies?: ProofDependencies): (request: ProofRequest, response: ProofResponse) => Promise<unknown>
