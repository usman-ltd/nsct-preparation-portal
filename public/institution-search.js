let seed;

const key = name => name.trim().replace(/\s+/g, " ").toLowerCase();
const searchable = name => key(name).replace(/\bgov(?:t|ernment)\b\.?/g, "government")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function loadSeed() {
  seed ??= fetch("/institutions.json").then(response => {
    if (!response.ok) throw new Error("Directory unavailable");
    return response.json();
  }).catch(error => { seed = undefined; throw error; });
  return seed;
}

export function attachInstitutionSearch(root, api) {
  const input = root.querySelector('[role="combobox"]');
  const share = root.querySelector('[name="shareInstitution"]');
  const list = root.querySelector('[role="listbox"]');
  const directory = new Map();
  let matches = [], limit = 50, active = -1, loaded = false, loading = false;
  let chosen = [];

  function draw(reset = false) {
    if (reset) {
      const words = searchable(input.value).split(" ").filter(Boolean);
      matches = [...directory.values()].filter(item => words.every(word => item.search.includes(word)))
        .sort((a,b) => a.name.localeCompare(b.name));
      limit = 50;
      active = -1;
      list.scrollTop = 0;
      input.removeAttribute("aria-activedescendant");
    }
    chosen = matches.slice(0, limit).map(item => ({ name: item.name }));
    const typed = input.value.trim().replace(/\s+/g, " ");
    if (typed && !directory.has(key(typed))) chosen.push({ name: typed, add: true });
    const fragment = document.createDocumentFragment();
    chosen.forEach(({ name, add }, index) => {
      const option = document.createElement("div");
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === active));
      option.dataset.index = index;
      option.id = "institution-option-" + index;
      option.textContent = add ? 'Add “' + name + '”' : name;
      if (add) option.className = "institution-add";
      fragment.append(option);
    });
    if (!chosen.length) fragment.append(loading ? "Loading institutions…" : "Type an institution name to add it.");
    list.replaceChildren(fragment);
  }

  function merge(names) {
    for (const name of names) {
      const id = key(name);
      if (!directory.has(id)) directory.set(id, { name, search: searchable(name) });
    }
    if (!list.hidden) draw(true);
  }

  async function open() {
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    draw(true);
    if (loaded || loading) return;
    loading = true;
    draw(true);
    const results = await Promise.allSettled([
      loadSeed().then(merge),
      api("institutions").then(data => merge(data.names)),
    ]);
    loaded = results.every(r => r.status === "fulfilled");
    loading = false;
    if (!list.hidden) draw(true);
  }

  function close() {
    list.hidden = true;
    active = -1;
    input.removeAttribute("aria-activedescendant");
    input.setAttribute("aria-expanded", "false");
  }

  function select(index) {
    const entry = chosen[index];
    if (!entry) return;
    input.value = entry.name;
    share.value = entry.add ? "yes" : "";
    close();
  }

  input.addEventListener("focus", open);
  input.addEventListener("click", () => { if (list.hidden) open(); });
  input.addEventListener("input", () => {
    share.value = "";
    if (list.hidden) open(); else draw(true);
  });
  input.addEventListener("blur", close);
  list.addEventListener("mousedown", e => e.preventDefault());
  list.addEventListener("click", e => {
    const option = e.target.closest('[role="option"]');
    if (option) select(Number(option.dataset.index));
  });
  list.addEventListener("scroll", () => {
    if (limit < matches.length && list.scrollTop + list.clientHeight >= list.scrollHeight - 12) {
      limit += 50;
      draw();
    }
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { close(); return; }
    if (e.key === "Enter" && !list.hidden && active >= 0) {
      e.preventDefault(); select(active); return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    if (list.hidden) open();
    if (e.key === "ArrowDown" && active === limit - 1 && limit < matches.length) limit += 50;
    active = Math.max(0, Math.min((active < 0 ? -1 : active) + (e.key === "ArrowDown" ? 1 : -1),
      Math.min(limit, matches.length) + (chosen.at(-1)?.add ? 1 : 0) - 1));
    draw();
    const selected = list.children[active];
    if (selected?.id) {
      input.setAttribute("aria-activedescendant", selected.id);
      selected.scrollIntoView({ block: "nearest" });
    }
  });
}
