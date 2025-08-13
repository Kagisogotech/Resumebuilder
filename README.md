# Resume Builder

A single-page resume builder application built with **HTML, CSS, and JavaScript**. This project allows users to create and customize resumes with different templates and AI-powered features, all without a backend server.

---

## Project Overview

The Resume Builder is a **client-side application** that uses JavaScript for dynamic rendering and API calls. It leverages third-party libraries for styling, icons, and PDF generation.

---

## Project Structure

resume-builder/
│
├── index.html           # Main HTML file containing the application structure, modals, and links to stylesheets & scripts
├── style.css            # Custom CSS (not handled by Tailwind)
├── code.js              # Primary JavaScript file handling events, state, API calls, and dynamic resume preview rendering
├── tailwind.config.js   # (Optional) Tailwind CSS configuration file for custom classes or plugins
│
├── assets/              # Folder for images, icons, and other static assets
├── fonts/               # Folder for Google Fonts (Inter)
└── lib/                 # Third-party libraries (if not using CDN)


## Libraries & Frameworks

The application uses the following libraries via **CDN**:

- **Tailwind CSS** – Utility-first CSS framework for rapid UI development  
- **Lucide Icons** – Collection of high-quality SVG icons  
- **Google Fonts (Inter)** – Clean, modern font  
- **html2pdf.js** – Converts HTML content to a downloadable PDF  

---
## Setup & Running the Application

### Method 1: Using a Local Web Server (Recommended)

This avoids browser security restrictions, especially for API calls.

1. **Install Python**  
   Download and install Python from [python.org](https://www.python.org/) if not already installed.

2. **Navigate to Project Directory**
   ```bash
   cd path/to/resume-builder
