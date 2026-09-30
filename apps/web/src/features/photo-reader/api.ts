import type { RuntimeConfig } from '../../lib/runtime';
import { analysisSchema } from './contracts';

export async function analyzePhoto(file: File, config: RuntimeConfig, accessToken: string, signal: AbortSignal) {
  const body = new FormData();
  body.append('image', file);
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}/labels/photo-analysis`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body, signal,
    });
  } catch (error) {
    if (signal.aborted) throw new Error('Análise interrompida ou tempo limite atingido. Não houve reenvio automático.');
    throw error;
  }
  if (!response.ok) {
    const message: unknown = await response.json().catch(() => null);
    if (message && typeof message === 'object' && 'detail' in message && typeof message.detail === 'string') {
      throw new Error(message.detail);
    }
    throw new Error(`O servidor não concluiu a análise (${response.status}).`);
  }
  const parsed = analysisSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('Resposta incompatível com o leitor V2. Atualize o servidor e o aplicativo.');
  return parsed.data;
}
