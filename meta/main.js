// meta/main.js
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import scrollama from "https://cdn.jsdelivr.net/npm/scrollama@3.2.0/+esm";

let data;
let commits;
let filteredCommits;

// global scales so brush / updates can see them
let xScale;
let yScale;

// slider-related globals
let commitProgress = 100;
let timeScale;
let commitMaxTime;

/* ---------------------------- Data loading ---------------------------- */

async function loadData() {
  const rows = await d3.csv("loc.csv", (row) => ({
    ...row,
    line: Number(row.line),
    depth: Number(row.depth),
    length: Number(row.length),
    date: new Date(row.date + "T00:00" + row.timezone),
    datetime: new Date(row.datetime),
  }));
  return rows;
}

function processCommits(data) {
  const grouped = d3.groups(data, (d) => d.commit);

  const processed = grouped.map(([commitId, lines]) => {
    const first = lines[0];
    const { author, date, time, timezone, datetime } = first;

    const ret = {
      id: commitId,
      url: "https://github.com/vis-society/lab-7/commit/" + commitId, // change to your repo if you want
      author,
      date,
      time,
      timezone,
      datetime,
      hourFrac: datetime.getHours() + datetime.getMinutes() / 60,
      totalLines: lines.length,
    };

    Object.defineProperty(ret, "lines", {
      value: lines,
      configurable: false,
      writable: false,
      enumerable: false,
    });

    return ret;
  });

  // sort by datetime so slider & brushing feel consistent
  processed.sort((a, b) => a.datetime - b.datetime);
  return processed;
}

/* --------------------------- Summary stats ---------------------------- */

function getDayPeriodLabel(date) {
  const hour = date.getHours();
  if (hour < 6) return "Night";
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

function renderCommitInfo(currentData, currentCommits) {
  const root = d3.select("#stats");
  root.selectAll("*").remove();

  const section = root.append("section").attr("class", "summary");
  section.append("h2").text("Summary");

  const dl = section.append("dl").attr("class", "stats");

  const addStat = (labelHtml, valueText) => {
    const stat = dl.append("div").attr("class", "stat");
    stat.append("dt").html(labelHtml);
    stat.append("dd").text(valueText);
  };

  if (!currentData.length || !currentCommits.length) {
    addStat("Commits", 0);
    addStat("Files", 0);
    addStat('Total <abbr title="Lines of code">LOC</abbr>', 0);
    addStat("Max depth", "–");
    addStat("Longest line", "–");
    addStat("Max lines", "–");
    addStat("Peak period", "–");
    return;
  }

  const numCommits = currentCommits.length;
  const numFiles = d3.group(currentData, (d) => d.file).size;
  const totalLoc = currentData.length;
  const maxDepth = d3.max(currentData, (d) => d.depth);
  const longestLine = d3.max(currentData, (d) => d.length);

  const fileLengths = d3.rollups(
    currentData,
    (v) => d3.max(v, (vv) => vv.line),
    (d) => d.file
  );
  const maxLines = d3.max(fileLengths, (d) => d[1]);

  const workByPeriod = d3.rollups(
    currentData,
    (v) => v.length,
    (d) => getDayPeriodLabel(d.datetime)
  );
  const maxPeriodEntry = d3.greatest(workByPeriod, (d) => d[1]);
  const peakPeriod = maxPeriodEntry ? maxPeriodEntry[0] : "–";

  addStat("Commits", numCommits);
  addStat("Files", numFiles);
  addStat('Total <abbr title="Lines of code">LOC</abbr>', totalLoc);
  addStat("Max depth", maxDepth);
  addStat("Longest line", longestLine);
  addStat("Max lines", maxLines);
  addStat("Peak period", peakPeriod);
}

/* ----------------------- Tooltip helper functions --------------------- */

function renderTooltipContent(commit) {
  if (!commit) return;

  const link = document.getElementById("commit-link");
  const dateEl = document.getElementById("commit-date");
  const timeEl = document.getElementById("commit-time-detail"); // <- time in tooltip
  const authorEl = document.getElementById("commit-author");
  const linesEl = document.getElementById("commit-lines");

  if (link) {
    link.href = commit.url;
    link.textContent = commit.id; // or "View on GitHub" if you prefer
  }

  if (dateEl) {
    dateEl.textContent = commit.datetime.toLocaleString("en", {
      dateStyle: "full",
    });
  }

  if (timeEl) {
    timeEl.textContent = commit.datetime.toLocaleString("en", {
      timeStyle: "short",
    });
  }

  if (authorEl) {
    authorEl.textContent = commit.author;
  }

  if (linesEl) {
    linesEl.textContent = `${commit.totalLines} lines edited`;
  }
}

function updateTooltipVisibility(isVisible) {
  const tooltip = document.getElementById("commit-tooltip");
  if (!tooltip) return;
  tooltip.hidden = !isVisible;
}

function updateTooltipPosition(event) {
  const tooltip = document.getElementById("commit-tooltip");
  if (!tooltip) return;
  const offset = 16;
  tooltip.style.left = `${event.clientX + offset}px`;
  tooltip.style.top = `${event.clientY + offset}px`;
}

/* ---------------------- Scatter plot + brushing ----------------------- */

function renderScatterPlot(allData, allCommits) {
  const width = 1000;
  const height = 400;
  const margin = { top: 10, right: 10, bottom: 30, left: 40 };

  const usableArea = {
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
    left: margin.left,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom,
  };

  const svg = d3
    .select("#chart")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .style("overflow", "visible");

  xScale = d3
    .scaleTime()
    .domain(d3.extent(allCommits, (d) => d.datetime))
    .range([usableArea.left, usableArea.right])
    .nice();

  yScale = d3
    .scaleLinear()
    .domain([0, 24])
    .range([usableArea.bottom, usableArea.top]);

  const gridlines = svg
    .append("g")
    .attr("class", "gridlines")
    .attr("transform", `translate(${usableArea.left}, 0)`);

  gridlines.call(
    d3.axisLeft(yScale).tickFormat("").tickSize(-usableArea.width)
  );

  const xAxis = d3.axisBottom(xScale);
  const yAxis = d3
    .axisLeft(yScale)
    .tickFormat((d) => String(d % 24).padStart(2, "0") + ":00");

  svg
    .append("g")
    .attr("transform", `translate(0, ${usableArea.bottom})`)
    .attr("class", "x-axis")
    .call(xAxis);

  svg
    .append("g")
    .attr("transform", `translate(${usableArea.left}, 0)`)
    .attr("class", "y-axis")
    .call(yAxis);

  const dots = svg.append("g").attr("class", "dots");

  const [minLines, maxLines] = d3.extent(allCommits, (d) => d.totalLines);
  const rScale = d3
    .scaleSqrt()
    .domain([minLines || 0, maxLines || 1])
    .range([2, 30]);

  const sortedCommits = d3.sort(allCommits, (d) => -d.totalLines);

  dots
    .selectAll("circle")
    .data(sortedCommits, (d) => d.id)
    .join("circle")
    .attr("cx", (d) => xScale(d.datetime))
    .attr("cy", (d) => yScale(d.hourFrac))
    .attr("r", (d) => rScale(d.totalLines))
    .attr("fill", "steelblue")
    .style("fill-opacity", 0.7)
    .on("mouseenter", (event, commit) => {
      d3.select(event.currentTarget).style("fill-opacity", 1);
      renderTooltipContent(commit);
      updateTooltipVisibility(true);
      updateTooltipPosition(event);
    })
    .on("mouseleave", (event) => {
      d3.select(event.currentTarget).style("fill-opacity", 0.7);
      updateTooltipVisibility(false);
    });

  createBrushSelector(svg);
}

function updateScatterPlot(allData, currentCommits) {
  if (!currentCommits.length) return;

  const width = 1000;
  const height = 400;
  const margin = { top: 10, right: 10, bottom: 30, left: 40 };
  const usableArea = {
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
    left: margin.left,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom,
  };

  const svg = d3.select("#chart").select("svg");
  if (svg.empty()) return;

  xScale.domain(d3.extent(currentCommits, (d) => d.datetime));

  const [minLines, maxLines] = d3.extent(currentCommits, (d) => d.totalLines);
  const rScale = d3
    .scaleSqrt()
    .domain([minLines || 0, maxLines || 1])
    .range([2, 30]);

  const xAxis = d3.axisBottom(xScale);

  const xAxisGroup = svg.select("g.x-axis");
  xAxisGroup.selectAll("*").remove();
  xAxisGroup.call(xAxis);

  const dots = svg.select("g.dots");

  const sortedCommits = d3.sort(currentCommits, (d) => -d.totalLines);

  dots
    .selectAll("circle")
    .data(sortedCommits, (d) => d.id)
    .join("circle")
    .attr("cx", (d) => xScale(d.datetime))
    .attr("cy", (d) => yScale(d.hourFrac))
    .attr("r", (d) => rScale(d.totalLines))
    .attr("fill", "steelblue")
    .style("fill-opacity", 0.7)
    .on("mouseenter", (event, commit) => {
      d3.select(event.currentTarget).style("fill-opacity", 1);
      renderTooltipContent(commit);
      updateTooltipVisibility(true);
      updateTooltipPosition(event);
    })
    .on("mouseleave", (event) => {
      d3.select(event.currentTarget).style("fill-opacity", 0.7);
      updateTooltipVisibility(false);
    });
}

/* ------------------------------ Brushing ------------------------------- */

function isCommitSelected(selection, commit) {
  if (!selection) return false;
  const [[x0, y0], [x1, y1]] = selection;
  const cx = xScale(commit.datetime);
  const cy = yScale(commit.hourFrac);
  return x0 <= cx && cx <= x1 && y0 <= cy && cy <= y1;
}

function renderSelectionCount(selection) {
  const baseCommits = filteredCommits ?? commits;
  const selectedCommits = selection
    ? baseCommits.filter((d) => isCommitSelected(selection, d))
    : [];

  const countElement = document.querySelector("#selection-count");
  if (!countElement) return;

  countElement.textContent = `${
    selectedCommits.length || "No"
  } commits selected`;

  return selectedCommits;
}

function renderLanguageBreakdown(selection) {
  const baseCommits = filteredCommits ?? commits;
  const selectedCommits = selection
    ? baseCommits.filter((d) => isCommitSelected(selection, d))
    : [];

  const container = document.getElementById("language-breakdown");
  if (!container) return;

  const requiredCommits =
    selectedCommits.length > 0 ? selectedCommits : baseCommits;

  const lines = requiredCommits.flatMap((d) => d.lines);

  if (!lines.length) {
    container.innerHTML = "";
    return;
  }

  const breakdown = d3.rollup(
    lines,
    (v) => v.length,
    (d) => d.type
  );

  container.innerHTML = "";
  for (const [language, count] of breakdown) {
    const proportion = count / lines.length;
    const formatted = d3.format(".1~%")(proportion);
    container.innerHTML += `
      <dt>${language}</dt>
      <dd>${count} lines (${formatted})</dd>
    `;
  }
}

function brushed(event) {
  const selection = event.selection;
  d3
    .selectAll(".dots circle")
    .classed("selected", (d) => isCommitSelected(selection, d));
  renderSelectionCount(selection);
  renderLanguageBreakdown(selection);
}

function createBrushSelector(svg) {
  const brush = d3.brush().on("start brush end", brushed);
  svg.call(brush);
  svg.selectAll(".dots, .overlay ~ *").raise();
}

/* ---------------------- File unit visualization ----------------------- */

function updateFileDisplay(currentCommits) {
  const container = d3.select("#files");
  container.selectAll("*").remove();

  const lines = currentCommits.flatMap((d) => d.lines);
  if (!lines.length) return;

  const files = d3
    .groups(lines, (d) => d.file)
    .map(([name, lines]) => {
      return {
        name,
        lines,
        type: lines[0]?.type, // assume file type from first line
      };
    })
    .sort((a, b) => b.lines.length - a.lines.length);

  // color scale by technology / type
  const colors = d3.scaleOrdinal(d3.schemeTableau10);

  const filesContainer = container
    .selectAll("div")
    .data(files, (d) => d.name)
    .join((enter) =>
      enter.append("div").call((div) => {
        div.append("dt");
        div.append("dd");
      })
    )
    .attr("style", (d) => `--color: ${colors(d.type)}`);

  filesContainer
    .select("dt")
    .html(
      (d) =>
        `<code>${d.name}</code><small>${d.lines.length} lines</small>`
    );

  // one .loc div per line
  filesContainer
    .select("dd")
    .selectAll("div")
    .data((d) => d.lines)
    .join("div")
    .attr("class", "loc");
}

/* ------------------------ Slider / time filtering ---------------------- */

function initializeTimeFiltering(allData, allCommits) {
  filteredCommits = allCommits;

  const slider = document.getElementById("commit-progress");
  const timeEl = document.getElementById("commit-time");
  if (!slider || !timeEl) return;

  timeScale = d3
    .scaleTime()
    .domain(d3.extent(allCommits, (d) => d.datetime))
    .range([0, 100]);

  commitProgress = 100;
  slider.value = String(commitProgress);
  commitMaxTime = timeScale.invert(commitProgress);

  timeEl.textContent = commitMaxTime.toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });

  function onTimeSliderChange() {
    commitProgress = +slider.value;
    commitMaxTime = timeScale.invert(commitProgress);

    timeEl.textContent = commitMaxTime.toLocaleString(undefined, {
      dateStyle: "long",
      timeStyle: "short",
    });

    filteredCommits = allCommits.filter(
      (d) => d.datetime <= commitMaxTime
    );
    if (!filteredCommits.length) {
      filteredCommits = [allCommits[0]];
    }

    const filteredData = allData.filter(
      (row) => row.datetime <= commitMaxTime
    );

    renderCommitInfo(filteredData, filteredCommits);
    updateScatterPlot(allData, filteredCommits);
    updateFileDisplay(filteredCommits);
  }

  slider.addEventListener("input", onTimeSliderChange);

  // initialize everything to "full" view
  onTimeSliderChange();
}

/* --------------------- Step 3: Scrollytelling setup ------------------- */

function setupScrollytelling(allData, allCommits) {
  // Generate one .step div per commit with narrative text
  d3
    .select("#scatter-story")
    .selectAll(".step")
    .data(allCommits)
    .join("div")
    .attr("class", "step")
    .html((d, i) => {
      const filesTouched = d3.rollups(
        d.lines,
        (D) => D.length,
        (row) => row.file
      ).length;

      return `
        On ${d.datetime.toLocaleString("en", {
          dateStyle: "full",
          timeStyle: "short",
        })},
        I made <a href="${d.url}" target="_blank">${
          i > 0
            ? "another glorious commit"
            : "my first commit, and it was glorious"
        }</a>.
        I edited ${d.totalLines} lines across ${filesTouched} files.
        Then I looked over all I had made, and I saw that it was very good.
      `;
    });

  const scroller = scrollama();

  function onStepEnter(response) {
    const commit = response.element.__data__;
    if (!commit || !timeScale) return;

    // Set commitMaxTime to this commit's time
    commitMaxTime = commit.datetime;

    // Sync slider + time label
    const slider = document.getElementById("commit-progress");
    const timeEl = document.getElementById("commit-time");

    commitProgress = timeScale(commitMaxTime);
    slider.value = String(commitProgress);
    timeEl.textContent = commitMaxTime.toLocaleString(undefined, {
      dateStyle: "long",
      timeStyle: "short",
    });

    // Filter data exactly like the slider does
    filteredCommits = allCommits.filter(
      (d) => d.datetime <= commitMaxTime
    );
    const filteredData = allData.filter(
      (row) => row.datetime <= commitMaxTime
    );

    renderCommitInfo(filteredData, filteredCommits);
    updateScatterPlot(allData, filteredCommits);
    updateFileDisplay(filteredCommits);
  }

  scroller
    .setup({
      container: "#scrolly-1",
      step: "#scrolly-1 .step",
    })
    .onStepEnter(onStepEnter);

  // Keep Scrollama layout in sync with viewport size
  window.addEventListener("resize", () => scroller.resize());
}

/* ------------------------------- Bootstrap ----------------------------- */

(async function init() {
  data = await loadData();
  commits = processCommits(data);
  filteredCommits = commits;

  renderCommitInfo(data, commits);
  renderScatterPlot(data, commits);
  updateFileDisplay(commits);

  initializeTimeFiltering(data, commits);
  setupScrollytelling(data, commits);
})();
