import type { Metadata } from "next";
import Link from "next/link";

import { EMPRESA } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Termos de Serviço",
  description:
    "Condições de uso da Métrica, plataforma de relatórios de marketing digital.",
};

export default function TermosDeServico() {
  return (
    <>
      <nav className="doc-nav">
        <Link href="/">← {EMPRESA.produto}</Link>
      </nav>

      <article className="doc">
        <h1>Termos de Serviço</h1>
        <p className="doc-meta">
          {EMPRESA.produto}, operado por {EMPRESA.razaoSocial}
          {EMPRESA.cnpj ? `, CNPJ ${EMPRESA.cnpj}` : ""}. Última atualização em{" "}
          {EMPRESA.atualizadoEm}.
        </p>

        <p>
          Ao criar uma conta ou usar a {EMPRESA.produto}, você concorda com
          estes termos. Se não concordar, não utilize o serviço.
        </p>

        <h2>1. O que é o serviço</h2>
        <p>
          A {EMPRESA.produto} é uma plataforma de geração de relatórios de
          marketing digital. Ela lê métricas de desempenho de contas de anúncio
          e análise que você autoriza a conectar, e as apresenta em relatórios
          organizados por cliente.
        </p>
        <p>
          O serviço é de <strong>leitura apenas</strong>. Ele não cria, edita,
          pausa nem exclui campanhas, anúncios, orçamentos ou qualquer
          configuração nas plataformas conectadas.
        </p>

        <h2>2. Conta e responsabilidades</h2>
        <ul>
          <li>
            Você é responsável por manter a confidencialidade das suas
            credenciais de acesso.
          </li>
          <li>
            Você declara ter autorização legítima para conectar cada conta de
            anúncio ou análise que vincular à plataforma, seja porque é a
            titular, seja porque foi autorizada por quem é.
          </li>
          <li>
            Você é responsável pelo conteúdo dos relatórios que compartilhar e
            pelos destinatários que indicar.
          </li>
        </ul>

        <h2>3. Uso aceitável</h2>
        <p>Não é permitido:</p>
        <ul>
          <li>
            Conectar contas para as quais você não tenha autorização do titular.
          </li>
          <li>
            Tentar obter acesso a projetos, dados ou contas de outra
            organização.
          </li>
          <li>
            Utilizar a plataforma para contornar limites, termos ou políticas
            das plataformas conectadas.
          </li>
          <li>
            Revender, redistribuir ou extrair sistematicamente os dados obtidos
            através do serviço para finalidade distinta da geração de relatórios.
          </li>
        </ul>
        <p>
          O descumprimento pode levar à suspensão imediata do acesso, sem aviso
          prévio.
        </p>

        <h2>4. Dados e privacidade</h2>
        <p>
          O tratamento de dados pessoais está descrito na{" "}
          <Link href="/politica-de-privacidade">Política de Privacidade</Link>,
          que é parte integrante destes termos.
        </p>
        <p>
          Os dados de métricas continuam pertencendo a você e ao titular da
          conta de origem. Não reivindicamos propriedade sobre eles e não os
          utilizamos para finalidade alheia à prestação do serviço.
        </p>

        <h2>5. Disponibilidade</h2>
        <p>
          Fazemos o possível para manter o serviço no ar, mas ele é fornecido{" "}
          <strong>no estado em que se encontra</strong>, sem garantia de
          disponibilidade ininterrupta.
        </p>
        <p>
          A plataforma depende de APIs operadas por Google e Meta. Mudanças,
          instabilidades, limites de cota ou descontinuações dessas APIs podem
          afetar a coleta de dados, e não temos controle sobre isso. Quando um
          dado não puder ser obtido, o relatório indica a ausência em vez de
          apresentar número estimado.
        </p>

        <h2>6. Limitação de responsabilidade</h2>
        <p>
          Os relatórios são ferramentas de apoio à decisão. Não nos
          responsabilizamos por decisões comerciais tomadas com base neles, nem
          por eventuais divergências entre os números apresentados e os painéis
          nativos das plataformas — divergências que podem ocorrer por
          diferenças de fuso horário, modelos de atribuição ou atualizações
          retroativas feitas pelas próprias plataformas.
        </p>
        <p>
          Na máxima extensão permitida em lei, nossa responsabilidade total fica
          limitada ao valor pago pelo serviço nos 12 meses anteriores ao evento
          que originou a reclamação.
        </p>

        <h2>7. Encerramento</h2>
        <p>
          Você pode encerrar sua conta a qualquer momento, escrevendo para{" "}
          <a href={`mailto:${EMPRESA.emailContato}`}>{EMPRESA.emailContato}</a>.
          Podemos encerrar ou suspender contas que violem estes termos.
        </p>
        <p>
          Após o encerramento, os dados são excluídos conforme a seção 6 da
          Política de Privacidade.
        </p>

        <h2>8. Alterações</h2>
        <p>
          Podemos atualizar estes termos. Mudanças relevantes são comunicadas
          por e-mail com antecedência razoável. O uso continuado após a
          vigência implica concordância.
        </p>

        <h2>9. Lei aplicável</h2>
        <p>
          Estes termos são regidos pelas leis brasileiras. Fica eleito o foro da
          comarca da sede da {EMPRESA.razaoSocial} para dirimir controvérsias,
          com renúncia a qualquer outro, por mais privilegiado que seja.
        </p>

        <h2>10. Contato</h2>
        <p>
          <a href={`mailto:${EMPRESA.emailContato}`}>{EMPRESA.emailContato}</a>
        </p>
      </article>
    </>
  );
}
