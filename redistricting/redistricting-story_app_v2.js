(function () {
  const data = window.STORY_DATA_V2;
  if (!data) return;

  const svg = document.getElementById("districtMap");
  const tooltip = document.getElementById("mapTooltip");
  const metricsById = new Map(data.districtMetrics.map((item) => [item.id, item]));
  const lawsuitByName = new Map(data.lawsuits.map((item) => [item.name, item]));

  const state = {
    mapMode: "new",
    layer: "partisan",
    district: 14,
    receiptFilter: "All",
    receiptDistrict: null,
    activeReceipt: null,
    activeSearchIndex: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    suppressDistrictClick: false,
  };
  let currentSearchResults = [];
  let mapContent = null;
  let dragState = null;

  const view = {
    width: 770,
    height: 650,
    pad: 28,
  };

  const queryConcepts = {
    partisan: ["partisan", "political", "party", "republican", "democratic", "gop", "red", "blue", "fox", "intent"],
    compactness: ["compactness", "compact", "polsby", "reock", "convex", "visual", "shape"],
    population: ["population", "census", "estimate", "growth", "edr", "acs", "overlaid"],
    race: ["race", "race-neutral", "black", "minority", "vra", "section 2", "strict scrutiny"],
    fair: ["fair", "districts", "article", "section", "20", "fda", "sever", "severability"],
    poreda: ["poreda", "mapmaker", "map drawer", "drawer"],
    jazil: ["jazil", "general counsel", "article", "section 20"],
    fox: ["fox", "news", "released", "leaked", "color-coded"],
    hearing: ["injunction", "temporary", "motion", "hearing", "appeal"],
  };

  const bbox = getBounds([...data.maps.old.features, ...data.maps.new.features]);

  function getBounds(features) {
    const box = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
    features.forEach((feature) => {
      walkCoordinates(feature.geometry.coordinates, (coord) => {
        box.minLon = Math.min(box.minLon, coord[0]);
        box.maxLon = Math.max(box.maxLon, coord[0]);
        box.minLat = Math.min(box.minLat, coord[1]);
        box.maxLat = Math.max(box.maxLat, coord[1]);
      });
    });
    return box;
  }

  function walkCoordinates(node, visit) {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      visit(node);
      return;
    }
    node.forEach((child) => walkCoordinates(child, visit));
  }

  function project(coord) {
    const lonRange = bbox.maxLon - bbox.minLon;
    const latRange = bbox.maxLat - bbox.minLat;
    const scale = Math.min(
      (view.width - view.pad * 2) / lonRange,
      (view.height - view.pad * 2) / latRange,
    );
    const mapWidth = lonRange * scale;
    const mapHeight = latRange * scale;
    const offsetX = (view.width - mapWidth) / 2;
    const offsetY = (view.height - mapHeight) / 2;
    return [
      offsetX + (coord[0] - bbox.minLon) * scale,
      offsetY + (bbox.maxLat - coord[1]) * scale,
    ];
  }

  function geometryPath(geometry) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return polygons
      .map((polygon) =>
        polygon
          .map((ring) =>
            ring
              .map((coord, index) => {
                const [x, y] = project(coord);
                return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
              })
              .join(" ") + " Z",
          )
          .join(" "),
      )
      .join(" ");
  }

  function pointFromGeometry(geometry) {
    if (!geometry) return null;
    if (geometry.type === "Point") return geometry.coordinates;
    let totalX = 0;
    let totalY = 0;
    let count = 0;
    walkCoordinates(geometry.coordinates, (coord) => {
      totalX += coord[0];
      totalY += coord[1];
      count += 1;
    });
    return count ? [totalX / count, totalY / count] : null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mix(hexA, hexB, t) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    const c = a.map((value, index) => Math.round(value + (b[index] - value) * t));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    return [0, 2, 4].map((offset) => parseInt(clean.slice(offset, offset + 2), 16));
  }

  function formatMargin(value) {
    const prefix = value >= 0 ? "D" : "R";
    return `${prefix}+${Math.abs(value).toFixed(1)}`;
  }

  function partyClass(value) {
    return value >= 0 ? "party-d" : "party-r";
  }

  function formatSignedPoints(value) {
    const direction = value >= 0 ? "D" : "R";
    return `${Math.abs(value).toFixed(1)} pts ${direction}`;
  }

  function partisanColor(margin) {
    const t = Math.min(1, Math.abs(margin) / 40);
    return margin >= 0
      ? mix("#d9e9f3", "#256da6", 0.28 + t * 0.72)
      : mix("#f1d3c9", "#c63b32", 0.28 + t * 0.72);
  }

  function compactnessColor(score) {
    const t = clamp((score - 0.16) / 0.55, 0, 1);
    if (t < 0.48) return mix("#c63b32", "#d39b25", t / 0.48);
    return mix("#d39b25", "#2f765d", (t - 0.48) / 0.52);
  }

  function challengeColor(metric) {
    const count = metric.claims.length;
    if (count === 0) return "#e2dacd";
    if (count === 1) return "#d39b25";
    if (count === 2) return "#c46332";
    return "#98251f";
  }

  function fillForDistrict(metric) {
    const activeMetric =
      state.mapMode === "old"
        ? { margin: metric.oldPres24, pp: metric.oldPP }
        : { margin: metric.newPres24, pp: metric.newPP };

    if (state.layer === "challenge") return challengeColor(metric);
    if (state.layer === "compactness") return compactnessColor(activeMetric.pp);
    return partisanColor(activeMetric.margin);
  }

  function getPlanFeatures() {
    return state.mapMode === "old" ? data.maps.old.features : data.maps.new.features;
  }

  function getPlanLabels() {
    return state.mapMode === "old" ? data.maps.old.labels.features : data.maps.new.labels.features;
  }

  function renderMap() {
    svg.setAttribute("viewBox", `0 0 ${view.width} ${view.height}`);
    svg.innerHTML = "";

    mapContent = document.createElementNS("http://www.w3.org/2000/svg", "g");
    mapContent.setAttribute("class", "map-content");
    svg.appendChild(mapContent);

    getPlanFeatures().forEach((feature) => {
      const id = Number(feature.properties.id || feature.properties.NAME);
      const metric = metricsById.get(id);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", geometryPath(feature.geometry));
      path.setAttribute("fill", fillForDistrict(metric));
      path.setAttribute("data-district", id);
      path.setAttribute("class", `district-path${state.district === id ? " is-active" : ""}`);
      path.setAttribute("tabindex", "0");
      path.setAttribute("role", "button");
      path.setAttribute("aria-label", `District ${id}`);
      path.style.opacity = state.mapMode === "overlay" ? "0.78" : "1";
      path.addEventListener("click", (event) => {
        if (state.suppressDistrictClick) {
          event.preventDefault();
          return;
        }
        selectDistrict(id);
      });
      path.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectDistrict(id);
        }
      });
      path.addEventListener("mousemove", (event) => showTooltip(event, metric));
      path.addEventListener("mouseleave", hideTooltip);
      mapContent.appendChild(path);
    });

    if (state.mapMode === "overlay") {
      data.maps.old.features.forEach((feature) => {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", geometryPath(feature.geometry));
        path.setAttribute("class", "old-outline");
        mapContent.appendChild(path);
      });
    }

    getPlanLabels().forEach((feature) => {
      const id = Number(feature.properties.id || feature.properties.NAME);
      const point = pointFromGeometry(feature.geometry);
      if (!point) return;
      const [x, y] = project(point);
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", x.toFixed(2));
      text.setAttribute("y", y.toFixed(2));
      text.setAttribute("class", "district-label");
      text.textContent = id;
      mapContent.appendChild(text);
    });

    applyMapTransform();
    updateMapCaption();
    renderMapLegend();
  }

  function updateMapCaption() {
    const title = document.getElementById("mapTitle");
    const desc = document.getElementById("mapDesc");
    const plan = state.mapMode === "old" ? "2022 congressional plan" : state.mapMode === "overlay" ? "2026 plan over 2022 outlines" : "2026 congressional plan";
    const layer =
      state.layer === "challenge"
        ? "Darker districts are challenged by more lawsuits."
        : state.layer === "compactness"
          ? "Redder districts have lower Polsby-Popper compactness."
          : "Districts are colored by 2024 presidential margin.";
    title.textContent = plan;
    desc.textContent = layer;
  }

  function renderMapLegend() {
    const legend = document.getElementById("mapLegend");
    if (!legend) return;
    if (state.mapMode !== "overlay") {
      legend.innerHTML = "";
      return;
    }
    legend.innerHTML = `
      <span><i class="legend-fill"></i>2026 fill</span>
      <span><i class="legend-line"></i>2022 outline</span>
    `;
  }

  function applyMapTransform() {
    if (!mapContent) return;
    mapContent.setAttribute(
      "transform",
      `translate(${state.panX.toFixed(2)} ${state.panY.toFixed(2)}) scale(${state.zoom.toFixed(4)})`,
    );
  }

  function svgPointFromEvent(event) {
    const rect = svg.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * view.width,
      ((event.clientY - rect.top) / rect.height) * view.height,
    ];
  }

  function setMapZoom(nextZoom, origin = [view.width / 2, view.height / 2]) {
    const oldZoom = state.zoom;
    const zoom = clamp(nextZoom, 1, 8);
    if (Math.abs(zoom - oldZoom) < 0.001) return;
    state.panX = origin[0] - (origin[0] - state.panX) * (zoom / oldZoom);
    state.panY = origin[1] - (origin[1] - state.panY) * (zoom / oldZoom);
    state.zoom = zoom;
    applyMapTransform();
  }

  function zoomMapBy(factor, origin) {
    setMapZoom(state.zoom * factor, origin);
  }

  function resetMapView() {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    applyMapTransform();
  }

  function currentFeatureForDistrict(id) {
    return getPlanFeatures().find((feature) => Number(feature.properties.id || feature.properties.NAME) === Number(id));
  }

  function projectedBounds(feature) {
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    walkCoordinates(feature.geometry.coordinates, (coord) => {
      const [x, y] = project(coord);
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
    });
    return box;
  }

  function focusSelectedDistrict() {
    const feature = currentFeatureForDistrict(state.district);
    if (!feature) return;
    const box = projectedBounds(feature);
    const width = Math.max(1, box.maxX - box.minX);
    const height = Math.max(1, box.maxY - box.minY);
    const padding = 120;
    const zoom = clamp(Math.min((view.width - padding) / width, (view.height - padding) / height), 1.8, 8);
    state.zoom = zoom;
    state.panX = view.width / 2 - ((box.minX + box.maxX) / 2) * zoom;
    state.panY = view.height / 2 - ((box.minY + box.maxY) / 2) * zoom;
    applyMapTransform();
  }

  function startMapPan(event) {
    if (event.button !== 0) return;
    dragState = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: state.panX,
      panY: state.panY,
      moved: false,
    };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("is-panning");
  }

  function continueMapPan(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((event.clientX - dragState.x) / rect.width) * view.width;
    const dy = ((event.clientY - dragState.y) / rect.height) * view.height;
    if (Math.abs(dx) + Math.abs(dy) > 2) dragState.moved = true;
    state.panX = dragState.panX + dx;
    state.panY = dragState.panY + dy;
    applyMapTransform();
  }

  function endMapPan(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (dragState.moved) {
      state.suppressDistrictClick = true;
      window.setTimeout(() => {
        state.suppressDistrictClick = false;
      }, 0);
    }
    try {
      svg.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be gone if the browser canceled the pointer.
    }
    dragState = null;
    svg.classList.remove("is-panning");
  }

  function showTooltip(event, metric) {
    tooltip.hidden = false;
    tooltip.innerHTML = `
      <strong>CD ${metric.id}</strong><br />
      2022: <span class="${partyClass(metric.oldPres24)}">${formatMargin(metric.oldPres24)}</span> |
      2026: <span class="${partyClass(metric.newPres24)}">${formatMargin(metric.newPres24)}</span><br />
      PP: ${metric.oldPP.toFixed(3)} -> ${metric.newPP.toFixed(3)}
    `;
    const x = Math.min(window.innerWidth - 292, event.clientX + 14);
    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${Math.max(8, event.clientY + 14)}px`;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function selectDistrict(id) {
    state.district = Number(id);
    renderMap();
    renderInspector();
  }

  function renderKpis() {
    const target = document.getElementById("kpis");
    target.innerHTML = [
      {
        value: `${data.summary.new2024R}R-${data.summary.new2024D}D`,
        label: "2026 map under 2024 presidential data",
      },
      {
        value: `${data.summary.old2024D - data.summary.new2024D} D seats`,
        label: "Democratic seats removed from the benchmark map",
      },
      {
        value: `${data.summary.fairDistrictsVote}%`,
        label: "Florida voters who backed Fair Districts in 2010",
      },
    ]
      .map(
        (item) => `
          <div class="kpi">
            <strong>${escapeHtml(item.value)}</strong>
            <span>${escapeHtml(item.label)}</span>
          </div>
        `,
      )
      .join("");
  }

  function renderInspector() {
    const metric = metricsById.get(state.district);
    document.getElementById("districtTitle").textContent = `CD ${metric.id}`;
    document.getElementById("districtSpotlight").textContent = metric.spotlight;
    setPartyMetric("oldMargin", metric.oldPres24);
    setPartyMetric("newMargin", metric.newPres24);
    document.getElementById("compositeShift").innerHTML = `<span class="${partyClass(metric.oldComposite)}">${formatMargin(metric.oldComposite)}</span> to <span class="${partyClass(metric.newComposite)}">${formatMargin(metric.newComposite)}</span>`;
    document.getElementById("ppShift").textContent = `${metric.oldPP.toFixed(3)} -> ${metric.newPP.toFixed(3)}`;
    document.getElementById("claimsCount").textContent = metric.claims.length ? `${metric.claims.length} cases` : "None";
    document.getElementById("districtClaims").innerHTML = metric.claims.length
      ? metric.claims.map((claim) => `<span class="chip">${escapeHtml(claim)}</span>`).join("")
      : `<span class="chip">Not directly challenged</span>`;
  }

  function setPartyMetric(id, value) {
    const node = document.getElementById(id);
    node.className = partyClass(value);
    node.textContent = formatMargin(value);
  }

  function renderAnalysisCards() {
    document.getElementById("analysisCards").innerHTML = data.analysisCards
      .map(
        (card) => `
          <article class="finding-card">
            <h3>${escapeHtml(card.title)}</h3>
            <strong>${escapeHtml(card.metric)}</strong>
            <div>
              <p>${escapeHtml(card.body)}</p>
              <p class="why">${escapeHtml(card.why)}</p>
            </div>
          </article>
        `,
      )
      .join("");
  }

  function countSeatsWithSwing(plan, swing) {
    let d = 0;
    let r = 0;
    data.districtMetrics.forEach((metric) => {
      const margin = (plan === "old" ? metric.oldPres24 : metric.newPres24) + swing;
      if (margin >= 0) d += 1;
      else r += 1;
    });
    return { d, r };
  }

  function renderSwing() {
    const slider = document.getElementById("swingSlider");
    const swing = Number(slider.value);
    document.getElementById("swingValue").textContent = swing >= 0 ? `D+${swing}` : `R+${Math.abs(swing)}`;
    const oldSeats = countSeatsWithSwing("old", swing);
    const newSeats = countSeatsWithSwing("new", swing);
    document.getElementById("swingPanels").innerHTML = `
      <article class="swing-panel">
        <span>2022 benchmark map</span>
        <strong>${oldSeats.r}R-${oldSeats.d}D</strong>
        <p>${swingText(oldSeats, "old")}</p>
      </article>
      <article class="swing-panel">
        <span>2026 governor map</span>
        <strong>${newSeats.r}R-${newSeats.d}D</strong>
        <p>${swingText(newSeats, "new")}</p>
      </article>
    `;
  }

  function swingText(seats, plan) {
    if (plan === "new" && seats.r >= 24) {
      return "The redraw still holds every converted Republican seat.";
    }
    if (seats.d >= 8) {
      return "Democrats have recovered at least the benchmark map's eight seats.";
    }
    return "The delegation changes, but the redraw still suppresses the Democratic ceiling.";
  }

  function dotPosition(margin) {
    return clamp(((margin + 40) / 80) * 100, 2, 98);
  }

  function renderMovementTable() {
    document.getElementById("movementTable").innerHTML = data.partisanMoves
      .slice(0, 10)
      .map((metric) => {
        const delta = metric.marginDelta;
        return `
          <div class="move-row" role="button" tabindex="0" data-select-district="${metric.id}">
            <strong>CD ${metric.id}</strong>
            <div class="move-track" title="2022 margin ${formatMargin(metric.oldPres24)}">
              <span class="move-dot old" style="left:${dotPosition(metric.oldPres24)}%"></span>
            </div>
            <div class="move-track" title="2026 margin ${formatMargin(metric.newPres24)}">
              <span class="move-dot new" style="left:${dotPosition(metric.newPres24)}%"></span>
            </div>
            <span>${formatSignedPoints(delta)}</span>
          </div>
        `;
      })
      .join("");
  }

  function renderCompactness() {
    const avgOldPP = average(data.districtMetrics.map((metric) => metric.oldPP));
    const avgNewPP = average(data.districtMetrics.map((metric) => metric.newPP));
    const avgOldReock = average(data.districtMetrics.map((metric) => metric.oldReock));
    const avgNewReock = average(data.districtMetrics.map((metric) => metric.newReock));
    const lowPPDelta = data.summary.newLowPP - data.summary.oldLowPP;

    document.getElementById("compactnessLab").innerHTML = `
      <article class="compact-card">
        <h3>The state's compactness defense is an average.</h3>
        <p>
          The statewide Polsby-Popper average moves from <strong>${avgOldPP.toFixed(3)}</strong>
          to <strong>${avgNewPP.toFixed(3)}</strong>. Reock moves from
          <strong>${avgOldReock.toFixed(3)}</strong> to <strong>${avgNewReock.toFixed(3)}</strong>.
          That narrow statewide change is real, but it masks where the damage lands.
        </p>
        <p>
          Low-compactness districts under 0.25 Polsby-Popper: <strong>${data.summary.oldLowPP}</strong>
          before, <strong>${data.summary.newLowPP}</strong> after${lowPPDelta > 0 ? `, up ${lowPPDelta}` : ""}.
        </p>
      </article>
      <article class="compact-card">
        <h3>Biggest Polsby-Popper drops.</h3>
        <div class="compact-list">
          ${data.compactDrops.slice(0, 10).map(renderCompactRow).join("")}
        </div>
      </article>
    `;
  }

  function renderCompactRow(metric) {
    const delta = metric.ppDelta;
    const width = clamp(Math.abs(delta) / 0.34 * 50, 2, 50);
    const side = delta >= 0 ? `left:50%; width:${width}%` : `left:${50 - width}%; width:${width}%`;
    return `
      <div class="compact-row${delta >= 0 ? " positive" : ""}" role="button" tabindex="0" data-select-district="${metric.id}">
        <strong>CD ${metric.id}</strong>
        <div class="compact-bar"><span style="${side}"></span></div>
        <span>${delta.toFixed(3)}</span>
      </div>
    `;
  }

  function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function receiptMatches(receipt) {
    const categoryMatch = state.receiptFilter === "All" || receipt.category === state.receiptFilter;
    const districtMatch = !state.receiptDistrict || receipt.districts.includes(state.receiptDistrict);
    return categoryMatch && districtMatch;
  }

  function receiptSortValue(receipt) {
    const order = ["Poreda", "Jazil", "General counsel", "Floor debate"];
    const categoryIndex = order.indexOf(receipt.category);
    return (categoryIndex === -1 ? 99 : categoryIndex) * 100 + receipt.rank;
  }

  function renderReceiptFilters() {
    const categories = ["All", ...new Set(data.receipts.map((receipt) => receipt.category))];
    let buttons = categories
      .map(
        (category) => `
          <button type="button" class="${state.receiptFilter === category ? "is-active" : ""}" data-receipt-category="${escapeHtml(category)}">
            ${escapeHtml(category)}
          </button>
        `,
      )
      .join("");

    if (state.receiptDistrict) {
      buttons += `
        <button type="button" class="is-active" data-clear-district="true">
          CD ${state.receiptDistrict} x
        </button>
      `;
    }
    document.getElementById("receiptFilters").innerHTML = buttons;
  }

  function renderReceipts() {
    const receipts = data.receipts
      .filter(receiptMatches)
      .sort((a, b) => receiptSortValue(a) - receiptSortValue(b));

    document.getElementById("receiptBoard").innerHTML = receipts.length
      ? receipts.map(renderReceiptCard).join("")
      : `<article class="receipt-card"><h3>No matching receipt.</h3><p>Clear the district chip or choose a broader category.</p></article>`;
  }

  function cleanSpeaker(value) {
    const text = String(value || "");
    if (text.includes("Poreda")) return "Poreda";
    if (text.includes("Jazil")) return "Mo Jazil";
    return text.replace("Ryan Newman/Alexman", "Ryan Newman/Axelman");
  }

  function renderReceiptCard(receipt) {
    const districtText = receipt.districts.length
      ? receipt.districts.map((id) => `CD ${id}`).join(", ")
      : "statewide";
    return `
      <article class="receipt-card${state.activeReceipt === receipt.id ? " is-active" : ""}" data-receipt-id="${escapeHtml(receipt.id)}">
        <div class="receipt-meta">
          <span>${escapeHtml(receipt.category)}</span>
          <span>${escapeHtml(districtText)}</span>
        </div>
        <h3>${escapeHtml(cleanSpeaker(receipt.speaker))}</h3>
        <blockquote>&ldquo;${escapeHtml(receipt.quote)}&rdquo;</blockquote>
        <div class="tearout">${escapeHtml(receipt.analysis)}</div>
        <div class="receipt-source">${escapeHtml(receipt.source)} | lines ${escapeHtml(receipt.line)}</div>
      </article>
    `;
  }

  function selectReceipt(id) {
    const receipt = data.receipts.find((item) => item.id === id);
    if (!receipt) return;
    state.activeReceipt = id;
    if (receipt.districts.length) {
      state.district = receipt.districts[0];
      renderInspector();
      renderMap();
    }
    openPdf({
      title: receipt.source,
      pdf: receipt.file,
      lineStart: receipt.line,
      lineEnd: "",
      text: `"${receipt.quote}" ${receipt.analysis}`,
    });
    renderReceipts();
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^\w\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getSearchCorpus() {
    const receiptItems = data.receipts.map((receipt) => ({
      title: `${receipt.category}: ${cleanSpeaker(receipt.speaker)}`,
      type: "Receipt",
      pdf: receipt.file,
      lineStart: receipt.line,
      lineEnd: "",
      text: `${receipt.quote} ${receipt.analysis}`,
      sourceRank: 0,
    }));
    const ocrItems = data.searchIndex.map((item) => ({ ...item, sourceRank: 1 }));
    return [...receiptItems, ...ocrItems];
  }

  function expandQuery(rawQuery) {
    const normalized = normalizeText(rawQuery);
    const tokens = new Set(normalized.split(" ").filter((token) => token.length > 1));
    Object.entries(queryConcepts).forEach(([key, words]) => {
      if (normalized.includes(key) || words.some((word) => normalized.includes(word))) {
        words.forEach((word) => {
          normalizeText(word)
            .split(" ")
            .filter(Boolean)
            .forEach((part) => tokens.add(part));
        });
      }
    });
    return {
      phrase: normalized,
      tokens: [...tokens],
    };
  }

  function scoreSearchItem(item, expanded) {
    const haystack = normalizeText(`${item.title} ${item.type} ${item.text}`);
    let score = 0;
    if (item.type === "Receipt") score += 42;
    if (expanded.phrase && haystack.includes(expanded.phrase)) score += 20;
    if (haystack.includes("partisan data")) score += 18;
    if (haystack.includes("every district")) score += 18;
    if (haystack.includes("mr poreda") || haystack.includes("poreda")) score += 16;
    if (haystack.includes("fox news")) score += 14;
    if (haystack.includes("section 20")) score += 14;
    if (haystack.includes("race neutral") || haystack.includes("race-neutral")) score += 14;
    expanded.tokens.forEach((token) => {
      const matches = haystack.split(token).length - 1;
      if (matches) score += Math.min(matches, 4) * (token.length > 4 ? 3 : 1);
    });
    if (/poreda|jazil|fox|partisan|compactness|section 20|race-neutral/.test(haystack)) score += 2;
    return score;
  }

  function runSearch() {
    const input = document.getElementById("docSearch");
    const expanded = expandQuery(input.value);
    const results = getSearchCorpus()
      .map((item, index) => ({ ...item, corpusIndex: index, score: scoreSearchItem(item, expanded) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.sourceRank - b.sourceRank || Number.parseInt(a.lineStart, 10) - Number.parseInt(b.lineStart, 10))
      .slice(0, 24);
    currentSearchResults = results;

    document.getElementById("searchStats").textContent = results.length
      ? `${results.length} matches shown from ${data.summary.searchChunks} OCR chunks plus ${data.receipts.length} curated receipts. Expanded terms: ${expanded.tokens.slice(0, 9).join(", ")}`
      : `No matches from ${data.summary.searchChunks} OCR chunks and ${data.receipts.length} curated receipts. Try a broader term.`;

    document.getElementById("searchResults").innerHTML = results.length
      ? results.map((item, position) => renderSearchResult(item, expanded.tokens, position)).join("")
      : "";

    if (results.length) {
      openSearchResult(0);
    }
  }

  function renderSearchResult(item, tokens, position) {
    const excerpt = highlight(trimText(item.text, 310), tokens);
    return `
      <article class="result-card${state.activeSearchIndex === position ? " is-active" : ""}" data-search-position="${position}">
        <strong>${escapeHtml(item.title)}</strong>
        <span class="receipt-source">${escapeHtml(lineLabel(item))} | ${item.type} | score ${item.score}</span>
        <p>${excerpt}</p>
      </article>
    `;
  }

  function lineLabel(item) {
    if (!item.lineStart && !item.lineEnd) return "Source excerpt";
    if (!item.lineEnd) return `Lines ${item.lineStart}`;
    return `Lines ${item.lineStart}-${item.lineEnd}`;
  }

  function highlight(text, tokens) {
    let escaped = escapeHtml(text);
    tokens
      .filter((token) => token.length > 3)
      .slice(0, 8)
      .forEach((token) => {
        const safe = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        escaped = escaped.replace(new RegExp(`(${safe})`, "gi"), "<mark>$1</mark>");
      });
    return escaped;
  }

  function trimText(text, maxLength) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (clean.length <= maxLength) return clean;
    return `${clean.slice(0, maxLength - 1).trim()}...`;
  }

  function openSearchResult(index) {
    const item = currentSearchResults[index];
    if (!item) return;
    state.activeSearchIndex = Number(index);
    openPdf(item);
    document.querySelectorAll(".result-card").forEach((node) => {
      node.classList.toggle("is-active", Number(node.dataset.searchPosition) === state.activeSearchIndex);
    });
  }

  function openPdf(item) {
    const pdfTitle = document.getElementById("pdfTitle");
    const pdfOpen = document.getElementById("pdfOpen");
    const pdfFrame = document.getElementById("pdfFrame");
    const detail = document.getElementById("resultDetail");
    const pdfPath = item.pdf || "#";
    pdfTitle.textContent = item.title || "Source PDF";
    pdfOpen.href = encodeURI(pdfPath);
    pdfFrame.src = `${encodeURI(pdfPath)}#toolbar=1&view=FitH`;
    detail.innerHTML = `
      <strong>${escapeHtml(item.title || "Source")}</strong>
      <p class="receipt-source">Lines ${escapeHtml(item.lineStart || "")}${item.lineEnd ? `-${escapeHtml(item.lineEnd)}` : ""}</p>
      <p>${escapeHtml(trimText(item.text || "", 900))}</p>
    `;
  }

  function renderLawsuits() {
    document.getElementById("lawsuitCards").innerHTML = data.lawsuits
      .map(
        (lawsuit) => `
          <article class="lawsuit-card">
            <div>
              <h3>${escapeHtml(lawsuit.name)}</h3>
              <span class="case-no">${escapeHtml(lawsuit.caseNo)}</span>
            </div>
            <ul class="case-list">
              ${lawsuit.claims.map((claim) => `<li>${escapeHtml(claim)}</li>`).join("")}
            </ul>
            <p><strong>Relief:</strong> ${escapeHtml(lawsuit.relief)}</p>
            <p><strong>Expected state answer:</strong> ${escapeHtml(lawsuit.stateAnswer)}</p>
          </article>
        `,
      )
      .join("");
  }

  function renderMatrix() {
    const names = data.lawsuits.map((lawsuit) => lawsuit.name);
    const challengedIds = data.districtMetrics
      .filter((metric) => metric.claims.length)
      .map((metric) => metric.id)
      .sort((a, b) => a - b);

    const rows = [
      `
        <div class="matrix-row matrix-head">
          <div>District</div>
          ${names.map((name) => `<div>${escapeHtml(shortCaseName(name))}</div>`).join("")}
          <div>Why it matters</div>
        </div>
      `,
      ...challengedIds.map((id) => {
        const metric = metricsById.get(id);
        return `
          <div class="matrix-row" role="button" tabindex="0" data-select-district="${id}">
            <div><strong>CD ${id}</strong></div>
            ${names
              .map((name) => {
                const lawsuit = lawsuitByName.get(name);
                return lawsuit.challenged.includes(id)
                  ? `<div class="matrix-hit">challenged</div>`
                  : `<div class="matrix-muted">-</div>`;
              })
              .join("")}
            <div>${escapeHtml(metric.flip24 ? `${formatMargin(metric.oldPres24)} to ${formatMargin(metric.newPres24)}` : metric.spotlight)}</div>
          </div>
        `;
      }),
    ];

    document.getElementById("lawsuitMatrix").innerHTML = rows.join("");
  }

  function shortCaseName(name) {
    if (name.startsWith("Common")) return "Common Cause";
    if (name.startsWith("Equal")) return "Equal Ground";
    return "Thompson-Wynn";
  }

  function bindEvents() {
    document.querySelectorAll("[data-map-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        state.mapMode = button.dataset.mapMode;
        document.querySelectorAll("[data-map-mode]").forEach((node) => node.classList.toggle("is-active", node === button));
        renderMap();
      });
    });

    document.querySelectorAll("[data-layer]").forEach((button) => {
      button.addEventListener("click", () => {
        state.layer = button.dataset.layer;
        document.querySelectorAll("[data-layer]").forEach((node) => node.classList.toggle("is-active", node === button));
        renderMap();
      });
    });

    document.querySelectorAll("[data-map-zoom]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.mapZoom;
        if (action === "in") zoomMapBy(1.35, [view.width / 2, view.height / 2]);
        if (action === "out") zoomMapBy(1 / 1.35, [view.width / 2, view.height / 2]);
        if (action === "reset") resetMapView();
        if (action === "district") focusSelectedDistrict();
      });
    });

    const fullscreenButton = document.querySelector("[data-map-fullscreen]");
    const mapPanel = document.querySelector(".map-panel");
    fullscreenButton.addEventListener("click", () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
        return;
      }
      const request = mapPanel.requestFullscreen?.();
      request?.catch?.(() => {});
    });

    document.addEventListener("fullscreenchange", () => {
      fullscreenButton.textContent = document.fullscreenElement === mapPanel ? "Exit" : "Full";
    });

    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
      zoomMapBy(factor, svgPointFromEvent(event));
    }, { passive: false });

    svg.addEventListener("pointerdown", startMapPan);
    svg.addEventListener("pointermove", continueMapPan);
    svg.addEventListener("pointerup", endMapPan);
    svg.addEventListener("pointercancel", endMapPan);

    document.getElementById("districtReceipts").addEventListener("click", () => {
      state.receiptDistrict = state.district;
      state.receiptFilter = "All";
      renderReceiptFilters();
      renderReceipts();
      document.getElementById("receipts").scrollIntoView({ behavior: "smooth", block: "start" });
    });

    document.getElementById("receiptFilters").addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.clearDistrict) {
        state.receiptDistrict = null;
      } else if (button.dataset.receiptCategory) {
        state.receiptFilter = button.dataset.receiptCategory;
      }
      renderReceiptFilters();
      renderReceipts();
    });

    document.getElementById("receiptBoard").addEventListener("click", (event) => {
      const card = event.target.closest("[data-receipt-id]");
      if (card) selectReceipt(card.dataset.receiptId);
    });

    document.getElementById("runSearch").addEventListener("click", runSearch);
    document.getElementById("docSearch").addEventListener("keydown", (event) => {
      if (event.key === "Enter") runSearch();
    });

    document.getElementById("searchResults").addEventListener("click", (event) => {
      const card = event.target.closest("[data-search-position]");
      if (card) openSearchResult(Number(card.dataset.searchPosition));
    });

    document.getElementById("swingSlider").addEventListener("input", renderSwing);

    document.body.addEventListener("click", (event) => {
      const row = event.target.closest("[data-select-district]");
      if (!row) return;
      selectDistrict(Number(row.dataset.selectDistrict));
      document.getElementById("top").scrollIntoView({ behavior: "smooth", block: "start" });
    });

    document.body.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target.closest("[data-select-district]");
      if (!row) return;
      event.preventDefault();
      selectDistrict(Number(row.dataset.selectDistrict));
      document.getElementById("top").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function init() {
    renderKpis();
    renderMap();
    renderInspector();
    renderAnalysisCards();
    renderSwing();
    renderMovementTable();
    renderCompactness();
    renderReceiptFilters();
    renderReceipts();
    renderLawsuits();
    renderMatrix();
    bindEvents();
    runSearch();
  }

  init();
})();
