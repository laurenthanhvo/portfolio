import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import scrollama from 'https://cdn.jsdelivr.net/npm/scrollama@3.2.0/+esm';

let xScale;
let yScale;

let data;
let commits;
let filteredCommits;

let commitProgress = 100;
let timeScale;
let commitMaxTime = null;

async function loadData() {
  const data = await d3.csv('loc.csv', (row) => ({
    ...row,
    line: Number(row.line),
    depth: Number(row.depth),
    length: Number(row.length),
    date: new Date(row.date + 'T00:00' + row.timezone),
    datetime: new Date(row.datetime),
  }));

  return data;
}

function processCommits(data) {
  return d3
    .groups(data, (d) => d.commit)
    .map(([commit, lines]) => {
      let first = lines[0];
      let { author, date, time, timezone, datetime } = first;

      return {
        id: commit,
        url: 'https://github.com/portfolio/commit/' + commit, 
        author,
        date,
        time,
        timezone,
        datetime,
        hourFrac: datetime.getHours() + datetime.getMinutes() / 60,
        totalLines: lines.length,
        lines: lines,
      };
    });
}

function renderCommitInfo(data, commits) {
  const statsRoot = d3.select('#stats');
  statsRoot.selectAll('*').remove();

  const dl = statsRoot.append('dl').attr('class', 'stats');

  dl.append('dt').html('Total <abbr title="Lines of code">LOC</abbr>');
  dl.append('dd').text(data.length);

  dl.append('dt').text('Total commits');
  dl.append('dd').text(commits.length);

  const timeOfDayCt = d3.rollup(
    commits,
    (v) => v.length,
    (d) => getTimeOfDay(d.hourFrac),
  );

  const mostActiveTime = Array.from(timeOfDayCt.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  dl.append('dt').text('Most active time');
  dl.append('dd').text(mostActiveTime ?? '—');

  const dayCt = d3.rollup(
    commits,
    (v) => v.length,
    (d) => d.datetime.getDay(),
  );

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const mostActiveDayIdx = Array.from(dayCt.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  const mostActiveDay = mostActiveDayIdx != null ? days[mostActiveDayIdx] : '—';

  dl.append('dt').text('Most active day');
  dl.append('dd').text(mostActiveDay);

  const uniqueFiles = new Set(data.map((d) => d.file));
  const numFiles = uniqueFiles.size;

  dl.append('dt').text('Total files');
  dl.append('dd').text(numFiles);

  function getTimeOfDay(hour) {
    if (hour >= 5 && hour < 12) return 'Morning';
    if (hour >= 12 && hour < 17) return 'Afternoon';
    if (hour >= 17 && hour < 21) return 'Evening';
    return 'Night';
  }
}

function renderScatterPlot(data, commits) {
  const width = 1000;
  const height = 600;

  const svg = d3
    .select('#chart')
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('overflow', 'visible');

  xScale = d3
    .scaleTime()
    .domain(d3.extent(commits, (d) => d.datetime))
    .range([0, width])
    .nice();

  yScale = d3.scaleLinear().domain([0, 24]).range([height, 0]);

  const dots = svg.append('g').attr('class', 'dots');

  const [minLines, maxLines] = d3.extent(commits, (d) => d.totalLines);
  const rScale = d3
    .scaleSqrt()
    .domain([minLines, maxLines])
    .range([2, 30]);

  const sortedCommits = d3.sort(commits, (d) => -d.totalLines);

  const margin = { top: 10, right: 10, bottom: 30, left: 20 };

  const usableArea = {
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
    left: margin.left,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom,
  };

  xScale.range([usableArea.left, usableArea.right]);
  yScale.range([usableArea.bottom, usableArea.top]);

  dots
    .selectAll('circle')
    .data(sortedCommits, (d) => d.id) 
    .join('circle')
    .attr('cx', (d) => xScale(d.datetime))
    .attr('cy', (d) => yScale(d.hourFrac))
    .attr('r', (d) => rScale(d.totalLines))
    .attr('fill', 'steelblue')
    .style('fill-opacity', 0.7)
    .on('mouseenter', (event, commit) => {
      d3.select(event.currentTarget).style('fill-opacity', 1);
      renderTooltipContent(commit);
      updateTooltipVisibility(true);
      updateTooltipPosition(event);
    })
    .on('mouseleave', (event) => {
      d3.select(event.currentTarget).style('fill-opacity', 0.7);
      updateTooltipVisibility(false);
    });

  const gridlines = svg
    .append('g')
    .attr('class', 'gridlines')
    .attr('transform', `translate(${usableArea.left}, 0)`);

  gridlines.call(
    d3.axisLeft(yScale).tickFormat('').tickSize(-usableArea.width),
  );

  const xAxis = d3.axisBottom(xScale);
  const yAxis = d3
    .axisLeft(yScale)
    .tickFormat((d) =>
      d === 24 ? '24:00' : String(d).padStart(2, '0') + ':00',
    );

  svg
    .append('g')
    .attr('transform', `translate(0, ${usableArea.bottom})`)
    .attr('class', 'x-axis')
    .call(xAxis);

  svg
    .append('g')
    .attr('transform', `translate(${usableArea.left}, 0)`)
    .attr('class', 'y-axis')
    .call(yAxis);


  function isCommitSelected(selection, commit) {
    if (!selection) return false;
    const [[x0, y0], [x1, y1]] = selection;
    const cx = xScale(commit.datetime);
    const cy = yScale(commit.hourFrac);
    return x0 <= cx && cx <= x1 && y0 <= cy && cy <= y1;
  }

  function renderSelectionCount(selection) {
    const selectedCommits = selection
      ? commits.filter((d) => isCommitSelected(selection, d))
      : [];

    const countElement = document.getElementById('selection-count');
    countElement.textContent = `${
      selectedCommits.length || 'No'
    } commits selected`;

    return selectedCommits;
  }

  function renderLanguageBreakdown(selection) {
    const selected = selection
      ? commits.filter((d) => isCommitSelected(selection, d))
      : [];

    const container = document.getElementById('language-breakdown');
    if (!selected.length) {
      container.innerHTML = '';
      return;
    }

    const lines = selected.flatMap((d) => d.lines);

    const breakdown = d3.rollup(
      lines,
      (v) => v.length,
      (d) => d.type,
    );

    container.innerHTML = '';
    for (const [language, count] of breakdown) {
      const proportion = count / lines.length;
      container.innerHTML += `
        <dt>${language}</dt>
        <dd>${count} lines (${d3.format('.1~%')(proportion)})</dd>
      `;
    }
  }

  function brushed(event) {
    const selection = event.selection;
    d3
      .selectAll('.dots circle')
      .classed('selected', (d) => isCommitSelected(selection, d));
    renderSelectionCount(selection);
    renderLanguageBreakdown(selection);
  }

  const brush = d3
    .brush()
    .extent([
      [usableArea.left, usableArea.top],
      [usableArea.right, usableArea.bottom],
    ])
    .on('start brush end', brushed);

  svg.append('g').attr('class', 'brush').call(brush);

  svg.selectAll('.dots').raise();
}

function renderTooltipContent(commit) {
  if (!commit) return;

  const link = document.getElementById('commit-link');
  const date = document.getElementById('commit-date');
  const timeDetail = document.getElementById('commit-time-detail');
  const author = document.getElementById('commit-author');
  const lines = document.getElementById('commit-lines');

  link.href = commit.url;
  link.textContent = commit.id;
  date.textContent = commit.datetime?.toLocaleString('en', {
    dateStyle: 'full',
  });
  timeDetail.textContent = commit.datetime.toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  author.textContent = commit.author;
  lines.textContent = `${commit.totalLines} lines edited`;
}

function updateTooltipVisibility(isVisible) {
  const tooltip = document.getElementById('commit-tooltip');
  tooltip.hidden = !isVisible;
}

function updateTooltipPosition(event) {
  const tooltip = document.getElementById('commit-tooltip');
  const offset = 16;
  tooltip.style.left = `${event.clientX + offset}px`;
  tooltip.style.top = `${event.clientY + offset}px`;
}

function updateFileDisplay() {
  const container = d3.select('#files');
  container.selectAll('*').remove();

  const lines = filteredCommits.flatMap((d) => d.lines);
  if (!lines.length) return;

  let files = d3
    .groups(lines, (d) => d.file)
    .map(([name, lines]) => {
      return { name, lines };
    })
    .sort((a, b) => b.lines.length - a.lines.length);

  let colors = d3.scaleOrdinal(d3.schemeTableau10);

  let filesContainer = container
    .selectAll('div')
    .data(files, (d) => d.name)
    .join((enter) =>
      enter.append('div').call((div) => {
        let dt = div.append('dt');
        dt.append('code');
        dt.append('small');
        div.append('dd');
      }),
    );

  filesContainer.select('dt > code').text((d) => d.name);
  filesContainer.select('dt > small').text((d) => `${d.lines.length} lines`);

  filesContainer
    .select('dd')
    .selectAll('div')
    .data((d) => d.lines)
    .join('div')
    .attr('class', 'loc')
    .attr('style', (d) => `--color: ${colors(d.type)}`);
}

function onTimeSliderChange() {
  const slider = document.getElementById('commit-progress');
  const timeElement = document.getElementById('commit-time');

  if (!slider || !timeElement) return;

  commitProgress = Number(slider.value);

  commitMaxTime = timeScale.invert(commitProgress);

  timeElement.textContent = commitMaxTime.toLocaleString([], {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  filteredCommits = commits.filter((d) => d.datetime <= commitMaxTime);
  if (!filteredCommits.length) {
    filteredCommits = [commits[0]];
  }

  updateScatterPlot(data, filteredCommits);
  updateFileDisplay();
  updateCommitStats(data, filteredCommits);
}

function updateScatterPlot(data, commitsSubset) {
  const width = 1000;
  const height = 600;
  const margin = { top: 10, right: 10, bottom: 30, left: 20 };
  const usableArea = {
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
    left: margin.left,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom,
  };

  const svg = d3.select('#chart').select('svg');
  if (svg.empty()) return;

  xScale = xScale.domain(d3.extent(commitsSubset, (d) => d.datetime));

  const [minLines, maxLines] = d3.extent(commitsSubset, (d) => d.totalLines);
  const rScale = d3.scaleSqrt().domain([minLines, maxLines]).range([2, 30]);

  const xAxis = d3.axisBottom(xScale);

  const xAxisGroup = svg.select('g.x-axis');
  xAxisGroup.selectAll('*').remove();
  xAxisGroup.call(xAxis);

  const dots = svg.select('g.dots');
  if (dots.empty()) return;

  const sortedCommits = d3.sort(commitsSubset, (d) => -d.totalLines);

  dots
    .selectAll('circle')
    .data(sortedCommits, (d) => d.id)
    .join('circle')
    .attr('cx', (d) => xScale(d.datetime))
    .attr('cy', (d) => yScale(d.hourFrac))
    .attr('r', (d) => rScale(d.totalLines))
    .attr('fill', 'steelblue')
    .style('fill-opacity', 0.7)
    .on('mouseenter', (event, commit) => {
      d3.select(event.currentTarget).style('fill-opacity', 1);
      renderTooltipContent(commit);
      updateTooltipVisibility(true);
      updateTooltipPosition(event);
    })
    .on('mouseleave', (event) => {
      d3.select(event.currentTarget).style('fill-opacity', 0.7);
      updateTooltipVisibility(false);
    });
}

function updateCommitStats(allData, commitsSubset) {
  d3.select('#stats').selectAll('*').remove();
  renderCommitInfo(allData, commitsSubset);
}

function setupScrollytelling() {
  d3
    .select('#scatter-story')
    .selectAll('.step')
    .data(commits)
    .join('div')
    .attr('class', 'step')
    .html(
      (d, i) => `
		On ${d.datetime.toLocaleString('en', {
      dateStyle: 'full',
      timeStyle: 'short',
    })},
		I made <a href="${d.url}" target="_blank">${
      i > 0 ? 'another awesome commit' : 'my first commit, and it was so awesome'
    }</a>.
		I edited ${d.totalLines} lines across ${
      d3.rollups(
        d.lines,
        (D) => D.length,
        (d) => d.file,
      ).length
    } files.
		Then I looked over all I had made, and I saw that it was very awesome.
	`,
    );

  function onStepEnter(response) {
    const activeCommit = response.element.__data__;
    if (!activeCommit) return;

    const cutoffDate = activeCommit.datetime;

    commitMaxTime = cutoffDate;
    if (timeScale) {
      commitProgress = timeScale(commitMaxTime);
      const sliderEl = document.getElementById('commit-progress');
      const timeEl = document.getElementById('commit-time');

      if (sliderEl) {
        sliderEl.value = String(commitProgress);
      }
      if (timeEl) {
        timeEl.textContent = commitMaxTime.toLocaleString([], {
          dateStyle: 'long',
          timeStyle: 'short',
        });
      }
    }

    filteredCommits = commits.filter((d) => d.datetime <= commitMaxTime);
    if (!filteredCommits.length) {
      filteredCommits = [commits[0]];
    }

    updateScatterPlot(data, filteredCommits);
    updateFileDisplay();
    updateCommitStats(data, filteredCommits);
  }

  const scroller = scrollama();
  scroller
    .setup({
      container: '#scrolly-1',
      step: '#scrolly-1 .step',
    })
    .onStepEnter(onStepEnter);

  window.addEventListener('resize', () => scroller.resize());
}

data = await loadData();
commits = processCommits(data);

commits.sort((a, b) => d3.ascending(a.datetime, b.datetime));

filteredCommits = commits;

renderCommitInfo(data, commits);
renderScatterPlot(data, commits);
updateFileDisplay();

timeScale = d3
  .scaleTime()
  .domain([
    d3.min(commits, (d) => d.datetime),
    d3.max(commits, (d) => d.datetime),
  ])
  .range([0, 100]);

document
  .getElementById('commit-progress')
  .addEventListener('input', onTimeSliderChange);

commitMaxTime = d3.max(commits, (d) => d.datetime);
commitProgress = 100;
const timeElInit = document.getElementById('commit-time');
if (timeElInit) {
  timeElInit.textContent = commitMaxTime.toLocaleString([], {
    dateStyle: 'long',
    timeStyle: 'short',
  });
}
updateCommitStats(data, filteredCommits);

setupScrollytelling();
