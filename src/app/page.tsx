import Link from "next/link";

import { EMPRESA } from "@/lib/legal";
import { listProviderSummaries } from "@/providers/registry";

/**
 * Pagina inicial publica.
 *
 * Alem de ser a porta de entrada, ela e lida pelo revisor do Google durante a
 * verificacao do app: precisa deixar evidente o que o produto faz e por que
 * ele pede acesso a dados do Google. Uma home vazia e motivo de reprovacao.
 */
export default function Home() {
  const providers = listProviderSummaries();

  return (
    <main
      style={{
        maxWidth: "760px",
        margin: "0 auto",
        padding: "88px 24px 120px",
      }}
    >
      <p
        style={{
          fontSize: "13px",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--brand)",
          margin: "0 0 18px",
          fontWeight: 600,
        }}
      >
        {EMPRESA.nomeFantasia}
      </p>

      <h1
        style={{
          fontSize: "clamp(36px, 6vw, 52px)",
          fontWeight: 700,
          lineHeight: 1.08,
          margin: "0 0 20px",
        }}
      >
        {EMPRESA.produto}
      </h1>

      <p
        style={{
          fontSize: "20px",
          lineHeight: 1.55,
          margin: "0 0 40px",
          maxWidth: "58ch",
        }}
      >
        Relatórios de marketing digital por cliente. Cada projeto reúne as
        contas de anúncio e análise em um só lugar, e os números são
        atualizados sozinhos todos os dias.
      </p>

      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "26px 28px",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <h2
          style={{
            fontSize: "15px",
            fontWeight: 600,
            margin: "0 0 4px",
          }}
        >
          Plataformas integradas
        </h2>
        <p
          style={{
            fontSize: "14px",
            color: "var(--muted)",
            margin: "0 0 20px",
          }}
        >
          Somente leitura. A Métrica não cria, edita nem pausa campanhas.
        </p>

        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          {providers.map((provider) => (
            <li
              key={provider.id}
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "16px",
                padding: "11px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  color: "var(--ink)",
                  fontWeight: 500,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: provider.brandColor,
                    flexShrink: 0,
                  }}
                />
                {provider.name}
              </span>
              <span
                className="tabular"
                style={{
                  fontSize: "13px",
                  color:
                    provider.availability === "ready"
                      ? "var(--positive)"
                      : "var(--attention)",
                  whiteSpace: "nowrap",
                }}
              >
                {provider.availability === "ready"
                  ? `${provider.metricCount} métricas`
                  : "aguardando liberação"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <nav
        style={{
          marginTop: "44px",
          display: "flex",
          gap: "20px",
          flexWrap: "wrap",
          fontSize: "15px",
        }}
      >
        <Link href="/politica-de-privacidade">Política de Privacidade</Link>
        <Link href="/termos-de-servico">Termos de Serviço</Link>
        <a href={`mailto:${EMPRESA.emailContato}`}>Contato</a>
      </nav>
    </main>
  );
}
