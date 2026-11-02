import os, json, uuid, random, hashlib, secrets
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS

BASE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE, ".env"))
SECRET = os.environ.get("JWT_SECRET", "change-me")
DIR = os.path.join(BASE, "data")
os.makedirs(DIR, exist_ok=True)


def read(name):
    try:
        with open(os.path.join(DIR, name + ".json"), encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, list) else []
    except Exception:
        return []


def write(name, data):
    with open(os.path.join(DIR, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def uid():
    return uuid.uuid4().hex[:10]


def hash_pw(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=32).hex()


def err(msg, code=400):
    return jsonify(error=msg), code


# Default admin: admin@exam.com / admin123
if not any(u.get("role") == "admin" for u in read("users")):
    s = secrets.token_hex(8)
    write("users", read("users") + [{
        "id": uid(), "name": "Admin", "email": "admin@exam.com",
        "salt": s, "hash": hash_pw("admin123", s), "role": "admin",
    }])

app = Flask(__name__)
CORS(app)


def auth(role=None):
    def deco(fn):
        @wraps(fn)
        def wrap(*args, **kwargs):
            try:
                token = request.headers.get("Authorization", "").replace("Bearer ", "")
                user = jwt.decode(token, SECRET, algorithms=["HS256"])
            except Exception:
                return err("Please login first", 401)
            if role and user.get("role") != role:
                return err("Access denied", 403)
            request.user = user
            return fn(*args, **kwargs)
        return wrap
    return deco


@app.get("/")
def home():
    return "ExamPortal Python Backend is running"


# ---------- Auth ----------
@app.post("/api/auth/register")
def register():
    b = request.get_json(silent=True) or {}
    name, email, password = b.get("name"), b.get("email"), b.get("password")
    if not (name and email and password):
        return err("All fields are required")
    users = read("users")
    if any(u["email"] == email for u in users):
        return err("Email already exists")
    s = secrets.token_hex(8)
    write("users", users + [{"id": uid(), "name": name, "email": email,
                             "salt": s, "hash": hash_pw(password, s), "role": "student"}])
    return jsonify(ok=True), 201


@app.post("/api/auth/login")
def login():
    b = request.get_json(silent=True) or {}
    u = next((x for x in read("users") if x["email"] == b.get("email")), None)
    if not u or u["hash"] != hash_pw(b.get("password") or "", u["salt"]):
        return err("Invalid email or password", 401)
    user = {"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"]}
    token = jwt.encode({**user, "exp": datetime.now(timezone.utc) + timedelta(days=1)}, SECRET, algorithm="HS256")
    return jsonify(token=token, user=user)


# ---------- Questions (admin) ----------
@app.get("/api/questions")
@auth("admin")
def questions_list():
    return jsonify(read("questions"))


@app.post("/api/questions")
@auth("admin")
def questions_add():
    b = request.get_json(silent=True) or {}
    text, options, answer = b.get("text"), b.get("options"), b.get("answer")
    if not text or not isinstance(options, list) or not all(options) or answer is None:
        return err("Question, 4 options and the correct answer are required")
    q = {"id": uid(), "text": text, "options": options, "answer": int(answer)}
    write("questions", read("questions") + [q])
    return jsonify(q), 201


@app.delete("/api/questions/<qid>")
@auth("admin")
def questions_delete(qid):
    write("questions", [q for q in read("questions") if q["id"] != qid])
    return jsonify(ok=True)


# ---------- Exams ----------
@app.get("/api/exams")
@auth()
def exams_list():
    return jsonify([{
        "id": e["id"], "title": e["title"], "duration": e["duration"],
        "count": e.get("poolCount") or len(e["questionIds"]),
        "random": bool(e.get("poolCount")),
    } for e in read("exams")])


@app.post("/api/exams")
@auth("admin")
def exams_add():
    b = request.get_json(silent=True) or {}
    title, duration = b.get("title"), b.get("duration")
    if not title or not duration:
        return err("Title and duration are required")
    pool = b.get("poolCount")
    if pool:
        n, total = int(pool), len(read("questions"))
        if n < 1 or n > total:
            return err(f"Pool has only {total} questions")
        e = {"id": uid(), "title": title, "duration": int(duration), "questionIds": [], "poolCount": n}
    else:
        ids = b.get("questionIds") or []
        if not ids:
            return err("Select at least 1 question")
        e = {"id": uid(), "title": title, "duration": int(duration), "questionIds": ids}
    write("exams", read("exams") + [e])
    return jsonify(e), 201


@app.delete("/api/exams/<eid>")
@auth("admin")
def exams_delete(eid):
    write("exams", [e for e in read("exams") if e["id"] != eid])
    return jsonify(ok=True)


@app.get("/api/exams/<eid>/start")
@auth("student")
def exam_start(eid):
    e = next((x for x in read("exams") if x["id"] == eid), None)
    if not e:
        return err("Exam not found", 404)
    allq = read("questions")
    if e.get("poolCount"):
        picked = random.sample(allq, min(e["poolCount"], len(allq)))
    else:
        picked = [q for q in allq if q["id"] in e["questionIds"]]
    attempt = {"id": uid(), "examId": e["id"], "userId": request.user["id"],
               "questionIds": [q["id"] for q in picked]}
    write("attempts", read("attempts") + [attempt])
    questions = [{k: v for k, v in q.items() if k != "answer"} for q in picked]
    return jsonify(attemptId=attempt["id"], id=e["id"], title=e["title"],
                   duration=e["duration"], questions=questions)


@app.post("/api/exams/<eid>/submit")
@auth("student")
def exam_submit(eid):
    e = next((x for x in read("exams") if x["id"] == eid), None)
    if not e:
        return err("Exam not found", 404)
    b = request.get_json(silent=True) or {}
    answers = b.get("answers") or {}
    attempts = read("attempts")
    a = next((x for x in attempts if x["id"] == b.get("attemptId")
              and x["examId"] == eid and x["userId"] == request.user["id"]), None)
    if not a:
        return err("Invalid or already submitted attempt")
    qs = [q for q in read("questions") if q["id"] in a["questionIds"]]
    score = sum(1 for q in qs if answers.get(q["id"]) == q["answer"])
    write("attempts", [x for x in attempts if x["id"] != a["id"]])
    r = {"id": uid(), "examId": e["id"], "examTitle": e["title"], "userId": request.user["id"],
         "userName": request.user["name"], "score": score, "total": len(a["questionIds"]),
         "date": datetime.now(timezone.utc).isoformat()}
    write("results", read("results") + [r])
    return jsonify(r)


# ---------- Results ----------
@app.get("/api/results")
@auth()
def results_list():
    allr = read("results")
    if request.user["role"] == "admin":
        return jsonify(allr)
    return jsonify([r for r in allr if r["userId"] == request.user["id"]])


@app.delete("/api/results/<rid>")
@auth("admin")
def results_delete(rid):
    write("results", [r for r in read("results") if r["id"] != rid])
    return jsonify(ok=True)


@app.delete("/api/results")
@auth("admin")
def results_clear():
    write("results", [])
    return jsonify(ok=True)


# ---------- Polls ----------
@app.get("/api/polls")
@auth()
def polls_list():
    admin = request.user["role"] == "admin"
    out = []
    for p in read("polls"):
        mine = next((v for v in p["votes"] if v["userId"] == request.user["id"]), None)
        counts = [sum(1 for v in p["votes"] if v["choice"] == i) for i in range(len(p["options"]))]
        out.append({"id": p["id"], "question": p["question"], "options": p["options"],
                    "total": len(p["votes"]), "myVote": mine["choice"] if mine else None,
                    "counts": counts if (admin or mine) else None})
    return jsonify(out)


@app.post("/api/polls")
@auth("admin")
def polls_add():
    b = request.get_json(silent=True) or {}
    q, options = b.get("question"), b.get("options")
    if not q or not isinstance(options, list) or len(options) < 2:
        return err("Question and at least 2 options are required")
    write("polls", read("polls") + [{"id": uid(), "question": q, "options": options, "votes": []}])
    return jsonify(ok=True), 201


@app.post("/api/polls/<pid>/vote")
@auth("student")
def polls_vote(pid):
    polls = read("polls")
    p = next((x for x in polls if x["id"] == pid), None)
    if not p:
        return err("Poll not found", 404)
    if any(v["userId"] == request.user["id"] for v in p["votes"]):
        return err("You already voted")
    try:
        choice = int((request.get_json(silent=True) or {}).get("choice"))
    except (TypeError, ValueError):
        return err("Invalid option")
    if not 0 <= choice < len(p["options"]):
        return err("Invalid option")
    p["votes"].append({"userId": request.user["id"], "choice": choice})
    write("polls", polls)
    return jsonify(ok=True)


@app.delete("/api/polls/<pid>")
@auth("admin")
def polls_delete(pid):
    write("polls", [p for p in read("polls") if p["id"] != pid])
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)