import { fetchJSON, renderProjects } from '../global.js';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

const projects = await fetchJSON('../lib/projects.json');
const projectsContainer = document.querySelector('.projects');

let query = '';
let selectedYearLabel = null;   
const searchInput = document.querySelector('.searchBar');

function getVisibleBySearch() {
  const q = (searchInput?.value || '').toLowerCase();
  return projects.filter((p) =>
    Object.values(p).join('\n').toLowerCase().includes(q)
  );
}

function renderPieChart(projectsGiven) {
  d3.select('#projects-plot').selectAll('*').remove();
  d3.select('.legend').selectAll('*').remove();

  const rolledData = d3.rollups(
    projectsGiven,
    (v) => v.length,
    (d) => d.year
  );

  const data = rolledData.map(([year, count]) => ({
    value: count,
    label: String(year),
  }));

  const sliceGenerator = d3.pie().value((d) => d.value);
  const arcData = sliceGenerator(data);
  const arcGenerator = d3.arc().innerRadius(0).outerRadius(50);
  const arcs = arcData.map((d) => arcGenerator(d));

  const colors = d3.scaleOrdinal(d3.schemeTableau10);

  arcs.forEach((arc, idx) => {
    d3.select('#projects-plot')
      .append('path')
      .attr('d', arc)
      .attr('fill', colors(idx));
  });

  const legend = d3.select('.legend');
  data.forEach((d, idx) => {
    legend
      .append('li')
      .attr('style', `--color:${colors(idx)}`)
      .html(`<span class="swatch"></span> ${d.label} <em>(${d.value})</em>`);
  });

  const sliceSel = d3.select('#projects-plot').selectAll('path');
  const legendSel = d3.select('.legend').selectAll('li');

  sliceSel.attr('class', (_, i) =>
    selectedYearLabel && data[i].label === selectedYearLabel ? 'selected' : ''
  );
  legendSel.attr('class', (_, i) =>
    selectedYearLabel && data[i].label === selectedYearLabel ? 'selected' : ''
  );

  sliceSel.each(function (_, i) {
    d3.select(this).on('click', () => {
      const label = data[i].label;
      selectedYearLabel = selectedYearLabel === label ? null : label;
      renderAll();
    });
  });

  legendSel.each(function (_, i) {
    d3.select(this).on('click', () => {
      const label = data[i].label;
      selectedYearLabel = selectedYearLabel === label ? null : label;
      renderAll();
    });
  });
}

function renderAll() {
  const visible = getVisibleBySearch(); 
  const listData =
    selectedYearLabel == null
      ? visible
      : visible.filter((p) => String(p.year) === String(selectedYearLabel));

  renderProjects(listData, projectsContainer, 'h2');
  renderPieChart(visible);
}

if (projects) {
  const titleElement = document.querySelector('.projects-title');
  if (titleElement) titleElement.textContent = `${projects.length} Projects`;
  renderAll();
} else {
  console.error('Projects data could not be loaded.');
}

searchInput?.addEventListener('input', (e) => {
  query = (e.target.value || '').toLowerCase();
  renderAll();
});
