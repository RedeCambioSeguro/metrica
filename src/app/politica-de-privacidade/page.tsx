import type { Metadata } from "next";
import Link from "next/link";

import { EMPRESA } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description:
    "Como a Métrica acessa, usa, armazena e exclui dados das plataformas de anúncio e análise conectadas.",
};

export default function PoliticaDePrivacidade() {
  return (
    <>
      <nav className="doc-nav">
        <Link href="/">← {EMPRESA.produto}</Link>
      </nav>

      <article className="doc">
        <h1>Política de Privacidade</h1>
        <p className="doc-meta">
          {EMPRESA.produto}, operado por {EMPRESA.razaoSocial}
          {EMPRESA.cnpj ? `, CNPJ ${EMPRESA.cnpj}` : ""}. Última atualização em{" "}
          {EMPRESA.atualizadoEm}.
        </p>

        <p>
          A {EMPRESA.produto} é uma ferramenta de geração de relatórios de
          marketing digital. Ela se conecta, com autorização explícita, a
          plataformas de anúncio e análise, lê as métricas de desempenho dessas
          contas e as apresenta em relatórios organizados por cliente.
        </p>

        <p>
          Este documento descreve exatamente quais dados são acessados, para
          quê, por quanto tempo ficam armazenados e como pedir sua exclusão.
        </p>

        <h2>1. Quem opera este serviço</h2>
        <p>
          {EMPRESA.razaoSocial}
          {EMPRESA.cnpj ? `, inscrita no CNPJ sob o nº ${EMPRESA.cnpj}` : ""}
          {EMPRESA.endereco ? `, com sede em ${EMPRESA.endereco}` : ""}, é a
          controladora dos dados tratados nesta plataforma, nos termos da Lei
          Geral de Proteção de Dados (Lei nº 13.709/2018).
        </p>
        <p>
          Contato para assuntos de privacidade:{" "}
          <a href={`mailto:${EMPRESA.emailContato}`}>{EMPRESA.emailContato}</a>.
        </p>

        <h2>2. Dados que coletamos</h2>

        <h3>2.1 Dados de cadastro</h3>
        <p>
          Nome, endereço de e-mail e senha criptografada das pessoas que acessam
          a plataforma. São usados exclusivamente para autenticação e para
          identificar quem realizou cada ação no sistema.
        </p>

        <h3>2.2 Dados das plataformas conectadas</h3>
        <p>
          Quando você autoriza a conexão de uma conta, recebemos um token de
          acesso que nos permite <strong>somente ler</strong> métricas de
          desempenho. Os dados lidos são estatísticas agregadas — nunca listas
          de pessoas, cadastros de clientes ou conteúdo de mensagens.
        </p>

        <table>
          <thead>
            <tr>
              <th>Plataforma</th>
              <th>O que lemos</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Google Analytics 4</td>
              <td>
                Sessões, usuários, visualizações de página, eventos, canais de
                origem, dispositivos e páginas mais acessadas
              </td>
            </tr>
            <tr>
              <td>Google Ads</td>
              <td>
                Impressões, cliques, investimento, conversões e desempenho por
                campanha e dispositivo
              </td>
            </tr>
            <tr>
              <td>Google Search Console</td>
              <td>
                Cliques, impressões, posição média, termos de busca e páginas de
                destino
              </td>
            </tr>
            <tr>
              <td>Google Meu Negócio</td>
              <td>
                Impressões na Busca e no Maps, cliques para ligar, pedidos de
                rota e cliques no site
              </td>
            </tr>
            <tr>
              <td>Meta Ads</td>
              <td>
                Impressões, alcance, cliques, investimento, resultados e
                desempenho por campanha
              </td>
            </tr>
          </tbody>
        </table>

        <p>
          Também armazenamos os nomes e identificadores das contas conectadas,
          para que você consiga distinguir uma conta de outra na interface.
        </p>

        <h3>2.3 O que não coletamos</h3>
        <ul>
          <li>Não lemos e-mails, arquivos, agenda ou contatos.</li>
          <li>
            Não acessamos listas de leads, cadastros de clientes ou qualquer
            dado pessoal de usuários finais dos sites analisados.
          </li>
          <li>
            Não temos permissão de escrita: a plataforma não cria, edita, pausa
            nem exclui campanhas, anúncios ou orçamentos.
          </li>
          <li>Não usamos cookies de rastreamento publicitário.</li>
        </ul>

        <h2>3. Como usamos os dados</h2>
        <p>
          Os dados são usados unicamente para gerar e exibir os relatórios que
          você solicita, e para as funções diretamente ligadas a isso:
          sincronizar as métricas periodicamente, calcular comparações entre
          períodos e enviar relatórios por e-mail aos destinatários que você
          indicar.
        </p>
        <p>
          <strong>
            Não vendemos, alugamos nem comercializamos dados sob qualquer forma.
          </strong>{" "}
          Não utilizamos os dados para publicidade, nem para treinar modelos de
          inteligência artificial, nem para qualquer finalidade alheia à geração
          dos seus relatórios.
        </p>

        <div className="callout">
          <h3 style={{ marginTop: 0 }}>
            Uso Limitado dos dados das APIs do Google
          </h3>
          <p>
            O uso e a transferência, pela {EMPRESA.produto}, de informações
            recebidas das APIs do Google obedecem à{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Política de Dados do Usuário dos Serviços de API do Google
            </a>
            , incluindo os requisitos de Uso Limitado.
          </p>
          <p>
            Na prática, isso significa que os dados obtidos das APIs do Google
            são usados apenas para oferecer as funcionalidades visíveis ao
            usuário nesta plataforma, não são transferidos a terceiros exceto
            quando necessário para operar o serviço ou por exigência legal, não
            são usados para publicidade e não são lidos por pessoas — salvo com
            sua autorização expressa, por exigência legal, ou para fins de
            segurança e resolução de problemas técnicos.
          </p>
        </div>

        <h2>4. Segurança e armazenamento</h2>
        <p>
          Os tokens de acesso às suas contas são criptografados com AES-256-GCM
          antes de serem gravados no banco de dados. A chave de criptografia é
          mantida separada do banco, de modo que uma cópia do banco de dados,
          isoladamente, não permite acesso às contas conectadas.
        </p>
        <p>
          Todo o tráfego entre seu navegador, a plataforma, o banco de dados e
          as APIs das plataformas ocorre exclusivamente por conexões
          criptografadas (TLS). O banco de dados fica hospedado em servidores
          localizados no Brasil.
        </p>
        <p>
          O acesso à plataforma exige autenticação, e cada usuário enxerga
          apenas os projetos da organização a que pertence.
        </p>

        <h2>5. Compartilhamento com terceiros</h2>
        <p>
          Não compartilhamos seus dados com terceiros para fins comerciais.
          Utilizamos os seguintes fornecedores de infraestrutura, que processam
          dados exclusivamente para manter o serviço no ar:
        </p>
        <table>
          <thead>
            <tr>
              <th>Fornecedor</th>
              <th>Finalidade</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Vercel</td>
              <td>Hospedagem da aplicação</td>
            </tr>
            <tr>
              <td>Neon</td>
              <td>Banco de dados (região São Paulo)</td>
            </tr>
          </tbody>
        </table>
        <p>
          Também podemos divulgar informações quando exigido por ordem judicial
          ou obrigação legal.
        </p>

        <h2>6. Retenção e exclusão</h2>
        <p>
          As métricas ficam armazenadas enquanto o projeto correspondente
          existir na plataforma, para permitir comparações históricas entre
          períodos.
        </p>
        <p>Você pode remover dados a qualquer momento:</p>
        <ul>
          <li>
            <strong>Desconectar uma conta</strong> apaga imediatamente o token
            de acesso e todas as métricas coletadas dela.
          </li>
          <li>
            <strong>Excluir um projeto</strong> apaga o projeto, suas conexões,
            métricas e relatórios.
          </li>
          <li>
            <strong>Encerrar a conta</strong> — escreva para{" "}
            <a href={`mailto:${EMPRESA.emailContato}`}>
              {EMPRESA.emailContato}
            </a>{" "}
            e apagamos todos os dados em até 30 dias.
          </li>
        </ul>

        <h2>7. Como revogar o acesso</h2>
        <p>
          Além de desconectar dentro da plataforma, você pode revogar a
          autorização diretamente nas plataformas de origem, a qualquer momento
          e sem depender de nós:
        </p>
        <ul>
          <li>
            Google:{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
            >
              myaccount.google.com/permissions
            </a>
          </li>
          <li>
            Meta:{" "}
            <a
              href="https://www.facebook.com/settings?tab=business_tools"
              target="_blank"
              rel="noopener noreferrer"
            >
              facebook.com/settings — Ferramentas empresariais
            </a>
          </li>
        </ul>
        <p>
          Ao revogar, a sincronização é interrompida imediatamente. Métricas já
          coletadas permanecem até que você exclua a conexão ou o projeto.
        </p>

        <h2>8. Seus direitos</h2>
        <p>
          A Lei Geral de Proteção de Dados garante a você o direito de confirmar
          a existência de tratamento, acessar seus dados, corrigir dados
          incompletos ou desatualizados, solicitar anonimização, bloqueio ou
          eliminação, requisitar a portabilidade, revogar o consentimento e
          obter informação sobre com quem compartilhamos dados.
        </p>
        <p>
          Para exercer qualquer um desses direitos, escreva para{" "}
          <a href={`mailto:${EMPRESA.emailContato}`}>{EMPRESA.emailContato}</a>.
          Respondemos em até 15 dias.
        </p>

        <h2>9. Alterações nesta política</h2>
        <p>
          Se esta política mudar de forma relevante, avisamos por e-mail antes
          de a alteração entrar em vigor. A data no topo da página sempre indica
          a última revisão.
        </p>

        <h2>10. Contato</h2>
        <p>
          {EMPRESA.razaoSocial}
          <br />
          {EMPRESA.endereco ? (
            <>
              {EMPRESA.endereco}
              <br />
            </>
          ) : null}
          <a href={`mailto:${EMPRESA.emailContato}`}>{EMPRESA.emailContato}</a>
        </p>
      </article>
    </>
  );
}
