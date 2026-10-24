import { useState } from 'react';
import type { ToolCall } from '../events/reducer';
import { BROWSE_TOOLS } from './format';

type SearchResult = { title: string; url: string; snippet: string };

// Shows what the agent looked up on the web. The browsing itself happens in backend tools
// (web_search / open_page / check_domain); this renders their results, it is not a real iframe,
// since most sites refuse to be framed.
export function AgentBrowser({ tools }: { tools: ToolCall[] }) {
  const visits = tools.filter((t) => BROWSE_TOOLS.has(t.tool));
  const [picked, setPicked] = useState<string | null>(null);
  const t = visits.find((v) => v.id === picked) ?? visits[visits.length - 1];

  return (
    <section className="cell browser">
      <h2>
        Agent browser <span className="count">{visits.length} lookups</span>
      </h2>
      <div className="window">
        <div className="tabs">
          {visits.length === 0 && <span className="tab">New tab</span>}
          {visits.map((v) => (
            <button
              key={v.id}
              className={`tab ${v === t ? 'active' : ''}`}
              onClick={() => setPicked(v === visits[visits.length - 1] ? null : v.id)}
            >
              {tabTitle(v)}
            </button>
          ))}
        </div>
        <div className="address">
          <span className="lock" aria-hidden />
          {t ? address(t) : 'about:blank'}
        </div>
        <div className={`loading ${t?.status === 'started' ? 'on' : ''}`} />
        <div className="viewport">
          {!t && <p className="empty">The agent searches and checks sites here while the call runs.</p>}
          {t?.status === 'started' && <Skeleton />}
          {t?.status === 'done' && <Page t={t} />}
        </div>
      </div>
    </section>
  );
}

function tabTitle(t: ToolCall): string {
  if (t.tool === 'web_search') return String(t.args.query);
  if (t.tool === 'check_domain') return `whois ${t.args.domain}`;
  return String(t.args.url);
}

function address(t: ToolCall): string {
  if (t.tool === 'web_search') return `search: ${t.args.query}`;
  if (t.tool === 'check_domain') return `whois.lookup/${t.args.domain}`;
  return `https://${t.args.url}`;
}

function Page({ t }: { t: ToolCall }) {
  const r = (t.result ?? {}) as Record<string, any>;
  if (r.error) return <p className="empty">{r.summary}</p>;
  if (t.tool === 'check_domain' && r.registered === false) {
    return (
      <dl className="whois enter">
        <dt>Domain</dt>
        <dd>{r.domain}</dd>
        <dt>Registered</dt>
        <dd className="bad">No, the domain doesn’t exist</dd>
      </dl>
    );
  }
  if (t.tool === 'web_search') {
    return (
      <ol className="results">
        {(r.results as SearchResult[]).map((x) => (
          <li key={x.url} className="enter">
            <span className="r-url">{x.url}</span>
            <span className="r-title">{x.title}</span>
            <span className="r-snippet">{x.snippet}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (t.tool === 'check_domain') {
    return (
      <dl className="whois enter">
        <dt>Domain</dt>
        <dd>{r.domain}</dd>
        <dt>Registered</dt>
        <dd className="bad">
          {r.registered} ({r.age_days} days ago)
        </dd>
        <dt>Registrar</dt>
        <dd>{r.registrar}</dd>
        <dt>Owner</dt>
        <dd>{r.owner}</dd>
        <dt>Official site</dt>
        <dd>{r.official_domain}</dd>
      </dl>
    );
  }
  const [before, after] = String(r.excerpt).split(r.highlight ?? '\u0000');
  return (
    <article className="page enter">
      <h3>{r.title}</h3>
      <p>
        {before}
        {after !== undefined && <mark>{r.highlight}</mark>}
        {after}
      </p>
    </article>
  );
}

function Skeleton() {
  return (
    <div className="skeleton" aria-hidden>
      <span style={{ width: '40%' }} />
      <span style={{ width: '85%' }} />
      <span style={{ width: '70%' }} />
      <span style={{ width: '35%' }} />
      <span style={{ width: '80%' }} />
    </div>
  );
}
