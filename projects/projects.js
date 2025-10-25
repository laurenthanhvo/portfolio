import { fetchJSON, renderProjects } from '../global.js';

const projects = await fetchJSON('../lib/projects.json');
const projectsContainer = document.querySelector('.projects');

if (projects) {
  const titleElement = document.querySelector('.projects-title');
  const projectCount = projects.length;
  if (titleElement) {
    titleElement.textContent = `${projectCount} Projects`;
  }
  renderProjects(projects, projectsContainer, 'h2');
} else {
  console.error("Projects data could not be loaded.");
}