(function () {
var SUPABASE_URL = "https://hpldvsyazlxncljipwio.supabase.co".trim();
var SUPABASE_KEY = "sb_publishable_XLu0NO---jpB8Fq5gkq8Ag_gdcCyguq".trim();
  var MILESTONES = ["Consultation", "Design", "Development", "Review", "Launch", "Support"];
  var PLAN_OPTS = ["Basic", "Standard", "Business Pro", "Custom"];
  var STATUS_OPTS = ["Active", "Onboarding", "Maintenance", "Inactive"];

  var configured = window.supabase && SUPABASE_URL.indexOf("http") === 0;
  var sb = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
  var timer = null;

  var R = function (n) { return "R" + Number(n).toLocaleString("en-ZA"); };
  var stop = function () { clearInterval(timer); };
  var go = function (role) { location.hash = role === "admin" ? "#/admin" : "#/portal"; };
  var curHash = function () { return location.hash.replace(/^#\//, "").split("?")[0].split("/")[0]; };
  var msg = function (sel, t) { var el = $(sel); if (el) el.innerHTML = t ? '<div class="ok">' + esc(t) + "</div>" : ""; };
  var inp = function (n, l, t, x) {
    return '<div><label>' + l + '</label><input name="' + n + '" type="' + (t || "text") + '" required ' + (x || "") + '></div>';
  };
  var formData = function (f) { var d = {}; new FormData(f).forEach(function (v, k) { d[k] = v; }); return d; };
  var opts = function (a) { return a.map(function (x) { return "<option>" + x + "</option>"; }).join(""); };
  function pv(milestones) {
    var done = milestones.filter(function (m) { return m.done; }).length;
    var next = milestones.filter(function (m) { return !m.done; })[0];
    return { progress: Math.round(done / milestones.length * 100), stage: next ? next.title : "Completed" };
  }
  function check(results) {
    results.forEach(function (r) { if (r.error) throw new Error(r.error.message); });
    return results;
  }

  /* quote requests from the public contact form */
  window.vmSaveEnquiry = async function (d) {
    if (!sb) return false;
    var r = await sb.from("enquiries").insert({ data: d });
    return !r.error;
  };

  /* ---------- views ---------- */
  V.login = function () {
    return '<h1 class="t">Login</h1><div id="msg"></div><form id="lf" class="card" style="max-width:420px">' +
      '<label>Email</label><input name="email" type="email" required autocomplete="username">' +
      '<label>Password</label><input name="password" type="password" required autocomplete="current-password">' +
      '<p><button class="btn">LOGIN</button></p><p><a href="#" id="fp" class="mu">Forgot password?</a></p></form>';
  };
  V.reset = function () {
    return '<h1 class="t">Set a new password</h1><div id="msg"></div><form id="rf" class="card" style="max-width:420px">' +
      '<label>New password (min 8 characters)</label><input name="p" type="password" minlength="8" required autocomplete="new-password">' +
      '<p><button class="btn">SAVE PASSWORD</button></p></form>';
  };
  V.portal = V.admin = function () { return '<div id="root"><p class="mu">Loading…</p></div>'; };

  async function loadMe() {
    if (!sb) return null;
    var s = (await sb.auth.getSession()).data.session;
    if (!s) return null;
    var p = await sb.from("profiles").select("role,name,client_id").eq("id", s.user.id).maybeSingle();
    if (!p.data) { await sb.auth.signOut(); return null; }
    return { id: s.user.id, email: s.user.email, role: p.data.role, name: p.data.name || "", client_id: p.data.client_id };
  }

  /* ---------- router guard (runs after script.js route()) ---------- */
  async function after() {
    stop();
    var h = curHash();
    var me = await loadMe();
    if (curHash() !== h) return; // user navigated away while loading

    var lg = document.querySelector('#nav a[href="#/login"]');
    if (lg && me) {
      lg.textContent = "Logout";
      lg.onclick = async function (e) {
        e.preventDefault();
        await sb.auth.signOut();
        location.hash = "#/login";
      };
    }

    if (h === "login") return me ? go(me.role) : mountLogin();
    if (h === "reset") return mountReset();
    if (h === "admin" || h === "portal") {
      if (!me) { location.hash = "#/login"; return; }
      var want = me.role === "admin" ? "admin" : "portal";
      if (h !== want) { location.hash = "#/" + want; return; }
      return h === "admin" ? mountAdmin(me) : mountClient(me);
    }
  }

  /* ---------- LOGIN / RESET ---------- */
  function mountLogin() {
    var f = $("#lf");
    if (!f) return;
    if (!sb) { msg("#msg", "Site not configured yet: add the Supabase URL and key in auth.js."); return; }
    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      var d = formData(f);
      var r = await sb.auth.signInWithPassword({ email: d.email.trim(), password: d.password });
      if (r.error) return msg("#msg", "Invalid email or password");
      var me = await loadMe();
      if (!me) return msg("#msg", "This account has no portal access. Contact VELMONT.");
      go(me.role);
    });
    $("#fp").addEventListener("click", async function (e) {
      e.preventDefault();
      var em = prompt("Enter your account email:");
      if (!em) return;
      var r = await sb.auth.resetPasswordForEmail(em.trim(), { redirectTo: location.origin + location.pathname });
      msg("#msg", r.error ? r.error.message : "If that email has an account, a reset link has been sent.");
    });
  }

  function mountReset() {
    var f = $("#rf");
    if (!f || !sb) return;
    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      var r = await sb.auth.updateUser({ password: formData(f).p });
      if (r.error) return msg("#msg", r.error.message);
      msg("#msg", "Password updated. Taking you to your dashboard…");
      setTimeout(function () { location.hash = "#/login"; }, 1200);
    });
  }

  /* ---------- ADMIN DASHBOARD ---------- */
  function mountAdmin(me) {
    var D = { clients: [], invoices: [], projects: [], enquiries: [] };

    $("#root").innerHTML =
      '<h1 class="t">VELMONT ADMIN</h1><p class="mu">Signed in as ' + esc(me.email) + '</p><div id="amsg"></div>' +
      '<h2 class="t">Clients</h2><div id="cl"></div>' +
      '<form id="cf" class="card" style="margin-top:14px"><h3 style="font-size:14px">Add client</h3><div class="two">' +
      inp("name", "Client name") + inp("industry", "Industry") +
      '<div><label>Package / core plan</label><select name="plan">' + opts(PLAN_OPTS) + '</select></div>' +
      '<div><label>Status</label><select name="status">' + opts(STATUS_OPTS) + '</select></div>' +
      inp("email", "Client login email", "email") + inp("password", "Temporary password (min 8)", "password", 'minlength="8" autocomplete="new-password"') +
      '</div><p><button class="btn">ADD CLIENT</button></p></form>' +
      '<h2 class="t">Invoices</h2>' +
      '<form id="if" class="card"><h3 style="font-size:14px">Create invoice (appears in the client\'s portal)</h3><div class="two">' +
      '<div><label>Client</label><select name="clientId" id="ic" required></select></div>' +
      inp("amount", "Amount (R)", "number", 'min="1" step="0.01"') + inp("dueDate", "Due date", "date") +
      '<div><label>Description</label><input name="description" maxlength="300"></div></div>' +
      '<p><button class="btn">CREATE INVOICE</button></p></form><div id="iv" style="margin-top:14px"></div>' +
      '<h2 class="t">Project progress</h2><div id="pr" class="grid"></div>' +
      '<h2 class="t">Quote enquiries</h2><div id="en"></div>';

    function render() {
      var names = {}; D.clients.forEach(function (c) { names[c.id] = c.name; });

      $("#cl").innerHTML = D.clients.length
        ? tbl(["Client Name", "Industry", "Package Core Plan", "Status", "Login"],
            D.clients.map(function (c) {
              return [esc(c.name), esc(c.industry), esc(c.plan), '<span class="pill">' + esc(c.status) + "</span>",
                esc(c.email) + ' <button class="btn o s" data-reset="' + esc(c.email) + '">Send password reset</button>'];
            }))
        : '<p class="mu">No clients yet.</p>';

      var sel = $("#ic"), v = sel.value;
      sel.innerHTML = D.clients.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + "</option>"; }).join("");
      if (v) sel.value = v;

      $("#iv").innerHTML = D.invoices.length
        ? tbl(["No.", "Client", "Amount", "Due", "Status", ""],
            D.invoices.map(function (i) {
              var next = i.status === "Paid" ? "Unpaid" : "Paid";
              return [esc(i.number), esc(names[i.client_id] || "Unknown"), R(i.amount), esc(i.due_date),
                '<span class="pill">' + esc(i.status) + "</span>",
                '<button class="btn o s" data-id="' + i.id + '" data-s="' + next + '">Mark ' + next + "</button>"];
            }))
        : '<p class="mu">No invoices yet.</p>';

      $("#pr").innerHTML = D.projects.map(function (p) {
        var s = pv(p.milestones);
        return '<div class="card"><h3 style="font-size:14px">' + esc(names[p.client_id] || "Unknown") + '</h3><div class="bar"><i style="width:' + s.progress + '%"></i></div>' +
          '<p class="mu">' + s.progress + "% · " + esc(s.stage) + "</p>" +
          p.milestones.map(function (m, i) {
            return '<label style="display:flex;gap:8px;align-items:center;margin:4px 0;color:var(--tx)"><input type="checkbox" style="width:auto" data-c="' +
              p.client_id + '" data-i="' + i + '"' + (m.done ? " checked" : "") + ">" + esc(m.title) + "</label>";
          }).join("") + "</div>";
      }).join("");

      $("#en").innerHTML = D.enquiries.length
        ? D.enquiries.map(function (e) {
            var d = e.data || {};
            return '<div class="card" style="margin-bottom:12px"><b>' + esc(d.name) + "</b> — " + esc(d.biz) +
              ' <span class="pill">' + esc(d.type) + '</span> <span class="pill">' + esc(d.budget) + "</span>" +
              '<p class="mu" style="margin:6px 0">' + esc(d.email) + " · " + esc(d.phone) + " · domain: " + esc(d.domain) + " · hosting: " + esc(d.host) +
              " · " + esc(new Date(e.created_at).toLocaleString("en-ZA")) + "</p><p>" + esc(d.details) + "</p></div>";
          }).join("")
        : '<p class="mu">No enquiries yet.</p>';
    }

    async function refresh() {
      if (document.hidden) return;
      try {
        var r = check(await Promise.all([
          sb.from("clients").select("*").order("created_at"),
          sb.from("invoices").select("*").order("created_at"),
          sb.from("projects").select("*"),
          sb.from("enquiries").select("*").order("created_at", { ascending: false })
        ]));
        D.clients = r[0].data; D.invoices = r[1].data; D.projects = r[2].data; D.enquiries = r[3].data;
        if ($("#cl")) render();
      } catch (e) { msg("#amsg", e.message); }
    }

    async function addClient(d) {
      var c = await sb.from("clients").insert({
        name: d.name.trim(), industry: d.industry.trim(), plan: d.plan, status: d.status, email: d.email.trim().toLowerCase()
      }).select().single();
      if (c.error) throw new Error(c.error.message);
      var undo = function () { return sb.from("clients").delete().eq("id", c.data.id); };

      // separate client so the admin stays logged in
      var tmp = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "vm-tmp" }
      });
      var u = await tmp.auth.signUp({ email: d.email.trim().toLowerCase(), password: d.password });
      if (u.error || !u.data.user) { await undo(); throw new Error(u.error ? u.error.message : "Could not create the login"); }

      var p = await sb.from("profiles").insert({ id: u.data.user.id, role: "client", name: d.name.trim(), client_id: c.data.id });
      if (p.error) { await undo(); throw new Error(p.error.message); }
      var j = await sb.from("projects").insert({ client_id: c.data.id, milestones: MILESTONES.map(function (t) { return { title: t, done: false }; }) });
      if (j.error) throw new Error(j.error.message);
    }

    async function addInvoice(d) {
      var r = await sb.from("invoices").insert({
        number: "INV-" + String(D.invoices.length + 1).padStart(3, "0"),
        client_id: d.clientId, amount: Number(d.amount), due_date: d.dueDate,
        description: (d.description || "").trim(), status: "Unpaid"
      });
      if (r.error) throw new Error(r.error.message);
    }

    function onSubmit(id, fn, done) {
      var f = $(id);
      f.addEventListener("submit", async function (e) {
        e.preventDefault();
        try { await fn(formData(f)); f.reset(); msg("#amsg", done); await refresh(); }
        catch (err) { msg("#amsg", err.message); }
      });
    }
    onSubmit("#cf", addClient, "Client added. They can log in now.");
    onSubmit("#if", addInvoice, "Invoice created. The client can see it in their portal.");

    $("#cl").addEventListener("click", async function (e) {
      var b = e.target.closest("button[data-reset]"); if (!b) return;
      var r = await sb.auth.resetPasswordForEmail(b.dataset.reset, { redirectTo: location.origin + location.pathname });
      msg("#amsg", r.error ? r.error.message : "Password reset email sent to " + b.dataset.reset);
    });
    $("#iv").addEventListener("click", async function (e) {
      var b = e.target.closest("button[data-id]"); if (!b) return;
      var r = await sb.from("invoices").update({ status: b.dataset.s }).eq("id", b.dataset.id);
      if (r.error) msg("#amsg", r.error.message); else refresh();
    });
    $("#pr").addEventListener("change", async function (e) {
      var c = e.target.dataset.c; if (!c) return;
      var p = D.projects.filter(function (x) { return x.client_id === c; })[0]; if (!p) return;
      var ms = p.milestones.map(function (m, i) { return i === Number(e.target.dataset.i) ? { title: m.title, done: e.target.checked } : m; });
      var r = await sb.from("projects").update({ milestones: ms }).eq("client_id", c);
      if (r.error) msg("#amsg", r.error.message); else refresh();
    });

    refresh();
    timer = setInterval(refresh, 10000);
  }

  /* ---------- CLIENT PORTAL ---------- */
  function mountClient(me) {
    $("#root").innerHTML =
      '<h1 class="t">Client Portal</h1><div id="cmsg"></div>' +
      '<h2 class="t">Project progress</h2><div id="pg"></div>' +
      '<h2 class="t">Billing</h2><div id="bl"></div>' +
      '<h2 class="t">Account settings</h2><div id="ac"></div>';

    async function refresh() {
      if (document.hidden) return;
      try {
        var r = check(await Promise.all([
          sb.from("clients").select("*").eq("id", me.client_id).maybeSingle(),
          sb.from("projects").select("*").eq("client_id", me.client_id).maybeSingle(),
          sb.from("invoices").select("*").eq("client_id", me.client_id).order("created_at")
        ]));
        var c = r[0].data || {}, p = r[1].data, inv = r[2].data;
        if (!$("#pg")) return;
        var s = p ? pv(p.milestones) : null;
        $("#pg").innerHTML = p
          ? '<div class="card"><p>Current stage: <b>' + esc(s.stage) + '</b> · <b>' + s.progress + '%</b> complete</p><div class="bar"><i style="width:' + s.progress + '%"></i></div>' +
            '<ul class="ck">' + p.milestones.map(function (m) {
              return '<li style="' + (m.done ? "color:var(--tx)" : "") + '">' + (m.done ? "" : "○ ") + esc(m.title) + "</li>";
            }).join("") + "</ul></div>"
          : '<p class="mu">No active project yet.</p>';
        $("#bl").innerHTML = inv.length
          ? tbl(["Invoice", "Description", "Amount", "Due", "Status"],
              inv.map(function (i) { return [esc(i.number), esc(i.description), R(i.amount), esc(i.due_date), '<span class="pill">' + esc(i.status) + "</span>"]; }))
          : '<p class="mu">No invoices yet.</p>';
        $("#ac").innerHTML = '<div class="card"><h3 style="font-size:14px">' + esc(me.name) + '</h3><p class="mu" style="margin:0">Email: ' + esc(me.email) +
          "<br>Industry: " + esc(c.industry || "-") + "<br>Package: " + esc(c.plan || "-") + "<br>Status: " + esc(c.status || "-") + "</p></div>";
      } catch (e) { msg("#cmsg", e.message); }
    }
    refresh();
    timer = setInterval(refresh, 10000);
  }

  if (sb) sb.auth.onAuthStateChange(function (ev) { if (ev === "PASSWORD_RECOVERY") location.hash = "#/reset"; });
  window.addEventListener("hashchange", after);
  route();
  after();
})();