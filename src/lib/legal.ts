/**
 * Dados da empresa usados nas paginas de politica de privacidade e termos.
 *
 * IMPORTANTE: a verificacao do app no Google le essas paginas. Documento com
 * campo em branco ou com texto de preenchimento e motivo de reprovacao - o
 * revisor abre a URL e confere. Complete tudo antes de solicitar a verificacao.
 */

export const EMPRESA = {
  nomeFantasia: "Rede Câmbio Seguro",

  /** PREENCHER: razao social completa, como no cartao CNPJ. */
  razaoSocial: "Rede Câmbio Seguro",

  /** PREENCHER: apenas numeros ou no formato 00.000.000/0000-00. */
  cnpj: "",

  /** PREENCHER: logradouro, numero, bairro, cidade, UF e CEP. */
  endereco: "",

  emailContato: "contato@redecambioseguro.com.br",

  /** Nome do produto, como aparece na tela de consentimento do Google. */
  produto: "Métrica",

  dominio: "relatorios.redecambioseguro.com.br",

  /** Data da ultima revisao dos documentos. */
  atualizadoEm: "4 de setembro de 2026",
} as const;

/** Avisa em desenvolvimento quando algum campo obrigatorio ficou vazio. */
export function camposPendentes(): string[] {
  const pendentes: string[] = [];
  if (!EMPRESA.cnpj) pendentes.push("cnpj");
  if (!EMPRESA.endereco) pendentes.push("endereco");
  return pendentes;
}
