import { useEffect, useState } from "react";

const API = "/api";
let token = localStorage.getItem("token") || "";

const call = async (url, method = "GET", body) => {
  const r = await fetch(API + url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong");
  return d;
};

const useLoad = (url) => {
  const [d, setD] = useState([]);
  const [err, setErr] = useState("");
  const load = () => call(url).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [url]);
  return [d, load, err];
};

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem("user") || "null"));
  const login = (d) => {
    token = d.token;
    localStorage.setItem("token", d.token);
    localStorage.setItem("user", JSON.stringify(d.user));
    setUser(d.user);
  };
  const logout = () => { token = ""; localStorage.clear(); setUser(null); };
  return (
    <div className="app">
      <h1>🎓 ExamPortal</h1>
      {user ? <Dashboard user={user} logout={logout} /> : <Auth onLogin={login} />}
    </div>
  );
}

function Auth({ onLogin }) {
  const [reg, setReg] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const go = async () => {
    try {
      if (reg) await call("/auth/register", "POST", f);
      onLogin(await call("/auth/login", "POST", f));
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="card auth">
      <h3>{reg ? "Student Register" : "Login"}</h3>
      {reg && <input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
      <input placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <input type="password" placeholder="Password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      {err && <div className="err">{err}</div>}
      <button onClick={go}>{reg ? "Register" : "Login"}</button>
      <a className="link" onClick={() => { setReg(!reg); setErr(""); }}>
        {reg ? "Already have an account? Login" : "New student? Register"}
      </a>
    </div>
  );
}

function Dashboard({ user, logout }) {
  const admin = user.role === "admin";
    const tabs = admin
    ? [["exams", "Exams"], ["create", "Create Exam"], ["questions", "Questions"], ["polls", "Polls"], ["results", "Results"]]
    : [["exams", "Exams"], ["polls", "Polls"], ["results", "My Results"]];
  const [tab, setTab] = useState("exams");
  const [taking, setTaking] = useState(null);

  if (taking) return <TakeExam examId={taking} onExit={() => setTaking(null)} />;
  return (
    <div>
      <p className="sub">
        {user.name} ({user.role}) <button className="del" onClick={logout}>Logout</button>
      </p>
      <nav>
        {tabs.map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>
      {tab === "exams" && <Exams user={user} onStart={setTaking} />}
      {tab === "create" && <CreateExam done={() => setTab("exams")} />}
      {tab === "questions" && <Questions />}
      {tab === "polls" && <Polls user={user} />}
      {tab === "results" && <Results user={user} />}
    </div>
  );
}

function Questions() {
  const empty = { text: "", options: ["", "", "", ""], answer: 0 };
  const [qs, reload] = useLoad("/questions");
  const [f, setF] = useState(empty);
  const [err, setErr] = useState("");
  const add = () =>
    call("/questions", "POST", f).then(() => { setF(empty); setErr(""); reload(); }).catch((e) => setErr(e.message));
  return (
    <div>
      <div className="card">
        <h3>Add Question</h3>
        <input placeholder="Question" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
        {f.options.map((o, i) => (
          <input key={i} placeholder={"Option " + "ABCD"[i]} value={o}
            onChange={(e) => setF({ ...f, options: f.options.map((x, j) => (j === i ? e.target.value : x)) })} />
        ))}
        <select value={f.answer} onChange={(e) => setF({ ...f, answer: Number(e.target.value) })}>
          {"ABCD".split("").map((c, i) => <option key={i} value={i}>Correct answer: {c}</option>)}
        </select>
        {err && <div className="err">{err}</div>}
        <button onClick={add}>Save Question</button>
      </div>
      <p>Total questions: {qs.length}</p>
      {qs.map((q) => (
        <div className="card" key={q.id}>
          <b>{q.text}</b>
          <ol type="A">{q.options.map((o, i) => <li key={i} className={i === q.answer ? "right" : ""}>{o}</li>)}</ol>
          <button className="del" onClick={() => call("/questions/" + q.id, "DELETE").then(reload)}>Delete</button>
        </div>
      ))}
    </div>
  );
}

function CreateExam({ done }) {
  const [qs] = useLoad("/questions");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(10);
  const [mode, setMode] = useState("pool");
  const [count, setCount] = useState(5);
  const [sel, setSel] = useState([]);
  const [err, setErr] = useState("");
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const save = () => {
    const body =
      mode === "pool" ? { title, duration, poolCount: count } : { title, duration, questionIds: sel };
    call("/exams", "POST", body).then(done).catch((e) => setErr(e.message));
  };
  return (
    <div className="card">
      <h3>Create Exam</h3>
      <input placeholder="Exam title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input type="number" placeholder="Duration (minutes)" value={duration} onChange={(e) => setDuration(e.target.value)} />
      <select value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="pool">Random questions from the Question Pool</option>
        <option value="manual">Select questions manually</option>
      </select>

      {mode === "pool" ? (
        <>
          <input type="number" min="1" max={qs.length} placeholder="Questions per student" value={count}
            onChange={(e) => setCount(e.target.value)} />
          <p>The pool has {qs.length} questions. Each student gets {count} random ones.</p>
        </>
      ) : (
        <>
          <p>Select questions ({sel.length} selected):</p>
          {qs.map((q) => (
            <label key={q.id} className="opt">
              <input type="checkbox" checked={sel.includes(q.id)} onChange={() => toggle(q.id)} /> {q.text}
            </label>
          ))}
        </>
      )}
      {qs.length === 0 && <p>Please add some questions in the "Questions" tab first.</p>}
      {err && <div className="err">{err}</div>}
      <button onClick={save}>Create Exam</button>
    </div>
  );
}

function Exams({ user, onStart }) {
  const [ex, reload] = useLoad("/exams");
  return (
    <div>
      {ex.length === 0 && <p>No exams available yet.</p>}
      {ex.map((e) => (
        <div className="card" key={e.id}>
          <h3>{e.title}</h3>
          <span className="tag">{e.count} questions{e.random ? " (random)" : ""} · {e.duration} min</span>
          {user.role === "student" ? (
            <button onClick={() => onStart(e.id)}>Start Exam</button>
          ) : (
            <button className="del" onClick={() => call("/exams/" + e.id, "DELETE").then(reload)}>Delete</button>
          )}
        </div>
      ))}
    </div>
  );
}

function TakeExam({ examId, onExit }) {
  const [ex, setEx] = useState(null);
  const [ans, setAns] = useState({});
  const [res, setRes] = useState(null);
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState("");

  useEffect(() => {
    call(`/exams/${examId}/start`)
      .then((d) => { setEx(d); setLeft(d.duration * 60); })
      .catch((e) => setErr(e.message));
  }, [examId]);

  const submit = () =>
    call(`/exams/${examId}/submit`, "POST", { attemptId: ex.attemptId, answers: ans })
      .then(setRes)
      .catch((e) => setErr(e.message));

  useEffect(() => {
    if (!ex || res) return;
    if (left <= 0) { submit(); return; }
    const t = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left, ex, res]);

  if (err) return <div><div className="err">{err}</div><button onClick={onExit}>Back</button></div>;
  if (!ex) return <p>Loading...</p>;
  if (res)
    return (
      <div className="score">
        {ex.title}: {res.score} / {res.total}
        <br /><br />
        <button onClick={onExit}>Back</button>
      </div>
    );

  const m = Math.floor(left / 60), s = String(left % 60).padStart(2, "0");
  return (
    <div>
      <div className="timer">{ex.title} — Time left: {m}:{s}</div>
      {ex.questions.map((q, n) => (
        <div className="card" key={q.id}>
          <h3>{n + 1}. {q.text}</h3>
          {q.options.map((o, i) => (
            <label key={i} className="opt">
              <input type="radio" name={"q" + q.id} checked={ans[q.id] === i} onChange={() => setAns({ ...ans, [q.id]: i })} /> {o}
            </label>
          ))}
        </div>
      ))}
      <button onClick={submit}>Submit Exam</button>
    </div>
  );
}

function Results({ user }) {
  const [rs, reload] = useLoad("/results");
  const admin = user.role === "admin";
  const del = (id) => call("/results/" + id, "DELETE").then(reload);
  const clearAll = () =>
    window.confirm("Delete ALL results?") && call("/results", "DELETE").then(reload);
  return (
    <div>
      {rs.length === 0 && <p>No results yet.</p>}
      {admin && rs.length > 0 && (
        <button className="del" onClick={clearAll}>Delete All Results</button>
      )}
      {rs.map((r) => (
        <div className="card" key={r.id}>
          <b>{r.examTitle}</b>
          {admin && <span>Student: {r.userName}</span>}
          <div>Score: {r.score} / {r.total} · {new Date(r.date).toLocaleString()}</div>
          {admin && <button className="del" onClick={() => del(r.id)}>Delete</button>}
        </div>
      ))}
    </div>
  );
}
function Polls({ user }) {
  const admin = user.role === "admin";
  const [polls, reload] = useLoad("/polls");
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState(["", "", "", ""]);
  const [err, setErr] = useState("");

  const create = () =>
    call("/polls", "POST", { question: q, options: opts.filter((o) => o.trim()) })
      .then(() => { setQ(""); setOpts(["", "", "", ""]); setErr(""); reload(); })
      .catch((e) => setErr(e.message));
  const vote = (id, choice) =>
    call(`/polls/${id}/vote`, "POST", { choice }).then(reload).catch((e) => setErr(e.message));

  return (
    <div>
      {admin && (
        <div className="card">
          <h3>Create Poll</h3>
          <input placeholder="Poll question" value={q} onChange={(e) => setQ(e.target.value)} />
          {opts.map((o, i) => (
            <input key={i} placeholder={"Option " + (i + 1)} value={o}
              onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} />
          ))}
          <button onClick={create}>Create Poll</button>
        </div>
      )}
      {err && <div className="err">{err}</div>}
      {polls.length === 0 && <p>No polls yet.</p>}
      {polls.map((p) => (
        <div className="card" key={p.id}>
          <h3>{p.question}</h3>
          {p.options.map((o, i) => {
            if (!p.counts) return <button key={i} onClick={() => vote(p.id, i)}>{o}</button>;
            const pct = p.total ? Math.round((p.counts[i] * 100) / p.total) : 0;
            return (
              <div className="bar" key={i}>
                <div className="fill" style={{ width: pct + "%" }} />
                <span>{o}{p.myVote === i ? " ✓" : ""} — {p.counts[i]} ({pct}%)</span>
              </div>
            );
          })}
          <span className="tag">{p.total} votes</span>
          {admin && (
            <button className="del" onClick={() => call("/polls/" + p.id, "DELETE").then(reload)}>Delete</button>
          )}
        </div>
      ))}
    </div>
  );
}