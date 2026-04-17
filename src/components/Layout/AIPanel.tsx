import React, { useState, useRef, useEffect } from 'react';
import {
  Bot, Lightbulb, RefreshCw, Activity, History,
  SearchCode, Send, ChevronRight, ChevronLeft, Loader2, Sparkles,
} from 'lucide-react';
import { api } from '../../data/api';
import type { ChatMessage } from '../../data/api';
import styles from './AIPanel.module.css';

/* ─── Quick prompts ─────────────────────────────────────────────── */
const QUICK_PROMPTS = [
  { icon: '📈', text: 'Why did costs spike last week?' },
  { icon: '💸', text: 'Which team overspent budget this month?' },
  { icon: '🔁', text: 'What if we switch EC2 to reserved?' },
  { icon: '🔮', text: 'What does the 30-day forecast look like?' },
];

/* ─── Markdown renderer ─────────────────────────────────────────── */
function renderMarkdown(text: string) {
  return text.split('\n').map((line, i) => {
    const parts = line.split(/\*\*(.*?)\*\*/g).map((p, j) =>
      j % 2 === 1 ? <strong key={j}>{p}</strong> : p
    );
    if (line.trimStart().startsWith('- '))
      return <li key={i} style={{ marginLeft: 14, color: 'var(--text-secondary)' }}>{parts}</li>;
    if (line.startsWith('## ') || line.startsWith('### '))
      return <p key={i} style={{ color: 'var(--violet)', fontWeight: 700, margin: '6px 0 2px' }}>{line.replace(/^#{2,3}\s/, '')}</p>;
    return <span key={i}>{parts}{i < text.split('\n').length - 1 ? <br /> : null}</span>;
  });
}

/* ─── Bubble ────────────────────────────────────────────────────── */
const Bubble: React.FC<{ msg: ChatMessage }> = ({ msg }) => {
  const isUser = msg.role === 'user';
  return (
    <div className={`${styles.messageRow} ${isUser ? styles.userRow : ''}`}>
      <div
        className={styles.messageAvatar}
        style={{
          background: isUser ? 'linear-gradient(135deg, var(--cyan-deep), var(--cyan-primary))' : 'rgba(139,92,246,0.15)',
          border: isUser ? 'none' : '1px solid rgba(139,92,246,0.25)',
          color: isUser ? '#000' : 'var(--violet)',
        }}
      >
        {isUser ? 'U' : <Bot size={12} />}
      </div>
      <div className={`${styles.messageBubble} ${isUser ? styles.userBubble : styles.aiBubble}`}>
        {isUser ? msg.content : renderMarkdown(msg.content)}
      </div>
    </div>
  );
};

/* ═══════════════ AI PANEL ══════════════════════════════════════════ */
const AIPanel: React.FC = () => {
  const [collapsed,  setCollapsed]  = useState(false);
  const [messages,   setMessages]   = useState<ChatMessage[]>([{
    role: 'assistant',
    content: "👋 Hi! I'm your FinOps AI. Ask me about cost spikes, team budgets, what-if scenarios, or forecasts.",
  }]);
  const [inputText, setInputText] = useState('');
  const [loading,   setLoading]   = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'log' | 'root' | 'sim'>('chat');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const updatedHistory = [...messages, userMsg];
    setMessages(updatedHistory);
    setInputText('');
    setLoading(true);
    try {
      const historyForApi = updatedHistory.slice(1);
      const res = await api.chat(trimmed, historyForApi.slice(0, -1));
      setMessages(prev => [...prev, { role: 'assistant', content: res.reply }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ ${err instanceof Error ? err.message : 'Failed to reach AI service.'}`,
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(inputText); }
  };

  const clearChat = () => setMessages([{
    role: 'assistant',
    content: "👋 Chat cleared! Ask me anything about your cloud costs.",
  }]);

  /* Collapsed */
  if (collapsed) {
    return (
      <aside style={{
        width: 38,
        background: 'linear-gradient(180deg, #080F1D, #050A14)',
        borderLeft: '1px solid var(--border-light)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 14,
        gap: 12,
        flexShrink: 0,
      }}>
        <button
          onClick={() => setCollapsed(false)}
          style={{ background: 'none', border: 'none', color: 'var(--violet)', cursor: 'pointer', padding: 5, borderRadius: 6 }}
          title="Expand AI Panel"
        >
          <ChevronLeft size={16} />
        </button>
        <Bot size={14} style={{ color: 'var(--text-muted)' }} />
        <Sparkles size={12} style={{ color: 'var(--violet)', opacity: 0.6 }} />
      </aside>
    );
  }

  const TABS = [
    { id: 'chat', icon: <Bot size={13} />,        label: 'CHAT' },
    { id: 'log',  icon: <History size={13} />,    label: 'LOG'  },
    { id: 'root', icon: <SearchCode size={13} />, label: 'ROOT' },
    { id: 'sim',  icon: <Activity size={13} />,   label: 'SIM'  },
  ] as const;

  return (
    <aside className={styles.aiPanel}>

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.title}>
            <Sparkles size={12} />
            AI Intelligence
          </div>
          <button className={styles.collapseBtn} onClick={() => setCollapsed(true)} title="Collapse">
            <ChevronRight size={14} />
          </button>
        </div>
        <div className={styles.subtitle}>
          Assistant: <span className={styles.assistantName}>Gemini FinOps Agent</span>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────── */}
      <div className={styles.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`${styles.tabBtn} ${activeTab === tab.id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Content ───────────────────────────────────────────────── */}
      <div className={styles.content} id="ai-chat-scroll">

        {activeTab === 'chat' && (
          <>
            {/* Quick prompts (only when no user msgs) */}
            {messages.length === 1 && (
              <div>
                <div className={styles.quickPromptsLabel}>Quick Prompts</div>
                {QUICK_PROMPTS.map(p => (
                  <button
                    key={p.text}
                    className={styles.quickPromptBtn}
                    onClick={() => sendMessage(p.text)}
                    disabled={loading}
                    style={{ marginBottom: 6 }}
                  >
                    <span>{p.icon}</span>
                    <span>{p.text}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Messages */}
            {messages.map((msg, i) => <Bubble key={i} msg={msg} />)}

            {/* Typing dots */}
            {loading && (
              <div className={styles.typingIndicator}>
                <div
                  className={styles.messageAvatar}
                  style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)', color: 'var(--violet)' }}
                >
                  <Bot size={12} />
                </div>
                <div className={styles.typingBubble}>
                  <div className={styles.typingDot} />
                  <div className={styles.typingDot} />
                  <div className={styles.typingDot} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}

        {activeTab === 'log' && (
          <div>
            <div className={styles.panelTitle}>Conversation Log</div>
            {messages.filter((m, i) => i > 0).map((m, i) => (
              <div key={i} className={styles.logEntry}>
                <span style={{ color: m.role === 'user' ? 'var(--cyan-primary)' : 'var(--violet)', fontWeight: 700, fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                  [{m.role.toUpperCase()}]
                </span>{' '}
                {m.content.slice(0, 130)}{m.content.length > 130 ? '…' : ''}
              </div>
            ))}
            {messages.length <= 1 && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No conversation yet.</span>
            )}
          </div>
        )}

        {activeTab === 'root' && (
          <div>
            <div className={styles.panelTitle}>Root Cause Analysis</div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.6 }}>
              Ask the AI in Chat mode:
            </p>
            {['Why did costs spike this week?', 'What caused the EC2 anomaly?', 'Which team has the highest deviation?'].map(q => (
              <button key={q} className={styles.simBtn} onClick={() => { setActiveTab('chat'); sendMessage(q); }}>
                💡 {q}
              </button>
            ))}
          </div>
        )}

        {activeTab === 'sim' && (
          <div>
            <div className={styles.panelTitle}>What-If Simulator</div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
              Run scenario analysis:
            </p>
            {['What if we switch EC2 to reserved instances?', 'What if we move storage to cold tier?', 'What if ml-team reduces compute by 20%?'].map(q => (
              <button
                key={q}
                className={styles.simBtn}
                onClick={() => { setActiveTab('chat'); sendMessage(q); }}
                disabled={loading}
              >
                🔁 {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Input ─────────────────────────────────────────────────── */}
      <div className={styles.inputArea}>
        <div className={styles.inputMeta}>
          <span className={styles.inputMetaText}>
            {loading ? '⏳ Thinking…' : `${messages.length - 1} msg${messages.length !== 2 ? 's' : ''}`}
          </span>
          <button className={styles.clearBtn} onClick={clearChat}>
            <RefreshCw size={10} /> Clear
          </button>
        </div>

        <div className={styles.inputWrapper}>
          <input
            ref={inputRef}
            id="ai-chat-input"
            type="text"
            placeholder="Ask AI Intelligence…"
            className={styles.aiInput}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            autoComplete="off"
          />
          <button
            id="ai-send-btn"
            className={styles.sendBtn}
            onClick={() => sendMessage(inputText)}
            disabled={loading || !inputText.trim()}
            title="Send (Enter)"
          >
            {loading ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          </button>
        </div>

        <div className={styles.inputHint}>
          <Lightbulb size={9} style={{ display: 'inline', marginRight: 3, verticalAlign: 'middle' }} />
          Press <kbd>Enter</kbd> to send
        </div>
      </div>
    </aside>
  );
};

export default AIPanel;
