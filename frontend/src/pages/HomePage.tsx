import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listProjects, type ProjectSummary } from '../api/projects';
import './HomePage.scss';

export function HomePage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listProjects()
      .then((data) => setProjects(data.filter((project) => project.archivedAt === null)))
      // A Member gets 403 here until ProjectAssignment scoping exists — same
      // empty state as an Admin with no projects yet, not an error.
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <main className="home-content" />;
  }

  if (projects.length === 0) {
    return (
      <main className="home-content">
        <div className="home-empty">
          <div className="home-empty-icon" aria-hidden="true">
            <BoxIcon />
          </div>
          <h2>Nothing here yet</h2>
          <p>Projects and their environments will show up here once they're set up.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="home-page">
      <h1>Projects</h1>
      <div className="table-scroll">
        <table className="home-projects-table">
          <thead>
            <tr>
              <th>Project Name</th>
              <th>Description</th>
              <th>Components</th>
              <th>Environments</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id} className="home-projects-row" onClick={() => navigate(`/projects/${project.id}`)}>
                <td className="home-projects-td-name">{project.name}</td>
                <td className="home-projects-td-description">{project.description || '—'}</td>
                <td>{project.components.length}</td>
                <td>{project.environmentCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function BoxIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M20 4 5 11.5 20 19l15-7.5L20 4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M5 11.5V28l15 7.5M35 11.5V28l-15 7.5M20 19v16.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
