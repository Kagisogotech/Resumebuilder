// A simple object to hold the application's state, similar to React's useState
 document.addEventListener('DOMContentLoaded', () => {
            // Function to show/hide elements with a fade transition
            const showElement = (element) => {
                element.classList.remove('hidden');
                setTimeout(() => {
                    element.style.opacity = 1;
                }, 10);
            };

            const hideElement = (element) => {
                element.style.opacity = 0;
                setTimeout(() => {
                    element.classList.add('hidden');
                }, 500); // This duration should match the CSS transition duration
            };

            const welcomePage = document.getElementById('welcome-page');
            const getStartedBtn = document.getElementById('get-started-btn');
            const mainContent = document.getElementById('main-content');

            // Handle the 'Get Started' button click
            getStartedBtn.addEventListener('click', () => {
                hideElement(welcomePage);
                showElement(mainContent);
            });
            
            // Re-render lucide icons after the main content is displayed
            // The icons will not show up until this is called
            lucide.createIcons();
        });
let state = {
    resumeData: {
        contact: {
            name: 'Your Name',
            title: 'Your Job Title',
            email: 'your.email@example.com',
            phone: '(123) 456-7890',
            linkedin: 'linkedin.com/in/yourprofile',
            location: 'City, State',
        },
        summary: 'A brief, impactful summary of your professional experience, skills, and goals. Mention key accomplishments and what you bring to the table.',
        experience: [
            {
                title: 'Job Title',
                company: 'Company Name',
                startDate: 'Start Year',
                endDate: 'End Year',
                description: 'Describe your key responsibilities and achievements in bullet points. Use action verbs and quantify results wherever possible. For example: "Led a team of 5 engineers..." or "Increased revenue by 15%..."',
            },
        ],
        education: [
            {
                degree: 'Degree / Field of Study',
                institution: 'University / Institution Name',
                year: 'Graduation Year',
            },
        ],
        skills: ['Skill 1', 'Skill 2', 'Skill 3', 'Skill 4'],
    },
    currentTemplate: 'modern',
    activeSection: 'contact',
};

// Function to save the current state to local storage
function saveState() {
    try {
        localStorage.setItem('resumeData', JSON.stringify(state.resumeData));
        localStorage.setItem('appState', JSON.stringify({
            currentTemplate: state.currentTemplate,
            activeSection: state.activeSection,
        }));
    } catch (e) {
        console.error("Failed to save data to local storage:", e);
    }
}

// Function to load the state from local storage
function loadState() {
    try {
        const storedResumeData = localStorage.getItem('resumeData');
        const storedAppState = localStorage.getItem('appState');
        if (storedResumeData) {
            state.resumeData = JSON.parse(storedResumeData);
        }
        if (storedAppState) {
            const appState = JSON.parse(storedAppState);
            state.currentTemplate = appState.currentTemplate || 'modern';
            state.activeSection = appState.activeSection || 'contact';
        }
    } catch (e) {
        console.error("Failed to load data from local storage:", e);
    }
}

// Renders the input fields for the currently active section on the left-hand side.
function renderInputPanel() {
    const inputSections = document.getElementById('input-sections');
    inputSections.innerHTML = ''; // Clear previous content

    const resumeData = state.resumeData;
    const section = state.activeSection;

    // A helper function to create a labeled input
    const createInputField = (label, value, field, small = false) => {
        const classes = small ? "p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all duration-200 text-sm w-full" : "p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all duration-200 w-full";
        return `
        <div class="flex flex-col gap-1">
            <label class="text-xs font-semibold text-slate-500">${label}</label>
            <input type="text" value="${value}" data-field="${field}" class="input-field p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all duration-200">
        </div>
    `;
    }

    // A helper function to create a labeled textarea
    const createTextareaField = (label, value, field) => `
        <div class="flex flex-col gap-1">
            <label class="text-xs font-semibold text-slate-500">${label}</label>
            <textarea data-field="${field}" class="textarea-field p-2 border border-slate-300 rounded-md h-24 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all duration-200">${value}</textarea>
        </div>
    `;

    // Render the appropriate section based on the active state
    let content = '';
    let iconName = '';
    let sectionTitle = '';

    switch (section) {
        case 'contact':
            sectionTitle = 'Contact Information';
            iconName = 'user';
            content = `
                ${createInputField('Full Name', resumeData.contact.name, 'name')}
                ${createInputField('Job Title', resumeData.contact.title, 'title')}
                ${createInputField('Email', resumeData.contact.email, 'email')}
                ${createInputField('Phone', resumeData.contact.phone, 'phone')}
                ${createInputField('LinkedIn', resumeData.contact.linkedin, 'linkedin')}
                ${createInputField('Location', resumeData.contact.location, 'location')}
            `;
            break;
        case 'summary':
            sectionTitle = 'Summary';
            iconName = 'file-text';
            content = `
                <div class="space-y-4">
                    ${createTextareaField('Professional Summary', resumeData.summary, 'summary')}
                    <button class="ai-suggestion-btn flex items-center gap-2 px-4 py-2 bg-sky-50 text-sky-700 rounded-full text-sm font-semibold hover:bg-sky-100 transition-colors" data-section="summary">
                        <span data-lucide="lightbulb" class="w-4 h-4"></span> Get AI Suggestions
                    </button>
                </div>
            `;
            break;
        case 'experience':
            sectionTitle = 'Work Experience';
            iconName = 'briefcase';
            content = `
                ${resumeData.experience.map((job, index) => `
                    <div class="p-4 bg-slate-50 rounded-lg border border-slate-200 relative mb-4" data-index="${index}">
                        <button class="remove-btn absolute top-2 right-2 text-red-500 hover:text-red-700 transition-colors" data-section="experience" data-index="${index}">
                            &times;
                        </button>
                        ${createInputField('Job Title', job.title, 'title')}
                        ${createInputField('Company', job.company, 'company')}
                        <div class="flex gap-4">
                            ${createInputField('Start Date', job.startDate, 'startDate')}
                            ${createInputField('End Date', job.endDate, 'endDate')}
                        </div>
                        ${createTextareaField('Job Description (Key Responsibilities)', job.description, 'description')}
                        <button class="ai-suggestion-btn flex items-center gap-2 px-4 py-2 mt-2 bg-sky-50 text-sky-700 rounded-full text-sm font-semibold hover:bg-sky-100 transition-colors" data-section="experience" data-index="${index}">
                            <span data-lucide="lightbulb" class="w-4 h-4"></span> Get AI Suggestions
                        </button>
                    </div>
                `).join('')}
                <button class="add-btn w-full px-4 py-2 text-sky-600 border-2 border-sky-600 rounded-lg hover:bg-sky-600 hover:text-white transition-colors" data-section="experience">
                    + Add Experience
                </button>
            `;
            break;
        case 'education':
            sectionTitle = 'Education';
            iconName = 'book';
            content = `
                ${resumeData.education.map((edu, index) => `
                    <div class="p-4 bg-slate-50 rounded-lg border border-slate-200 relative mb-4" data-index="${index}">
                        <button class="remove-btn absolute top-2 right-2 text-red-500 hover:text-red-700 transition-colors" data-section="education" data-index="${index}">
                            &times;
                        </button>
                        ${createInputField('Degree/Certificate', edu.degree, 'degree')}
                        ${createInputField('Institution', edu.institution, 'institution')}
                        ${createInputField('Graduation Year', edu.year, 'year')}
                    </div>
                `).join('')}
                <button class="add-btn w-full px-4 py-2 text-sky-600 border-2 border-sky-600 rounded-lg hover:bg-sky-600 hover:text-white transition-colors" data-section="education">
                    + Add Education
                </button>
            `;
            break;
        case 'skills':
            sectionTitle = 'Skills';
            iconName = 'lightbulb';
            content = `
                <div class="space-y-4">
                    ${createTextareaField('Skills (comma-separated)', resumeData.skills.join(', '), 'skills')}
                    <button class="ai-suggestion-btn flex items-center gap-2 px-4 py-2 mt-2 bg-sky-50 text-sky-700 rounded-full text-sm font-semibold hover:bg-sky-100 transition-colors" data-section="skills">
                        <span data-lucide="lightbulb" class="w-4 h-4"></span> Get AI Suggestions
                    </button>
                </div>
            `;
            break;
    }

    inputSections.innerHTML = `
        <div class="p-6 bg-white rounded-xl shadow-md border border-slate-200">
            <h2 class="text-xl font-semibold mb-4 flex items-center gap-2 text-slate-700">
                <span data-lucide="${iconName}" class="w-5 h-5"></span> ${sectionTitle}
            </h2>
            <div class="space-y-4">
                ${content}
            </div>
        </div>
    `;

    // Re-create icons for the new content
    lucide.createIcons();
}

// Renders the resume preview on the right-hand side.
function renderResumePreview() {
    const previewContainer = document.getElementById('resume-preview-container');
    const resumeData = state.resumeData;

    const templateClasses = {
        modern: 'template-container modern',
        classic: 'template-container classic',
        professional: 'template-container professional',
    };

    const templateClassName = templateClasses[state.currentTemplate];

    previewContainer.innerHTML = `
        <div class="flex-1 overflow-auto ${templateClassName}">
            <div class="text-center mb-6 border-b border-slate-200 pb-4">
                <h1 class="text-4xl font-bold text-[var(--primary-color)] mb-1">${resumeData.contact.name}</h1>
                <h2 class="text-xl font-medium text-[var(--text-color)] mb-4">${resumeData.contact.title}</h2>
                <div class="flex justify-center items-center gap-4 text-sm text-[var(--secondary-text-color)]">
                    <div class="flex items-center gap-1">
                        <span data-lucide="mail" class="w-4 h-4"></span>
                        <span>${resumeData.contact.email}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <span data-lucide="phone" class="w-4 h-4"></span>
                        <span>${resumeData.contact.phone}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <span data-lucide="linkedin" class="w-4 h-4"></span>
                        <span>${resumeData.contact.linkedin}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <span data-lucide="map-pin" class="w-4 h-4"></span>
                        <span>${resumeData.contact.location}</span>
                    </div>
                </div>
            </div>

            <div class="mb-6">
                <h3 class="section-title">Summary</h3>
                <p class="text-sm text-[var(--secondary-text-color)]">${resumeData.summary}</p>
            </div>

            <div class="mb-6">
                <h3 class="section-title">Experience</h3>
                <div class="space-y-4">
                    ${resumeData.experience.map(job => `
                        <div>
                            <div class="flex justify-between items-baseline">
                                <h4 class="font-bold">${job.title}</h4>
                                <span class="text-sm text-[var(--secondary-text-color)]">${job.startDate} - ${job.endDate}</span>
                            </div>
                            <h5 class="italic text-[var(--secondary-text-color)] mb-1">${job.company}</h5>
                            <ul class="resume-ul">
                                ${job.description.split('\n').filter(line => line.trim()).map(line => `
                                    <li>${line.replace(/^-/, '').trim()}</li>
                                `).join('')}
                            </ul>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="mb-6">
                <h3 class="section-title">Education</h3>
                <div class="space-y-2">
                                ${resumeData.education.map(edu => `
                                    <div>
                                        <div class="flex justify-between items-baseline">
                                            <h4 class="font-bold">${edu.degree}</h4>
                                            <span class="text-sm text-[var(--secondary-text-color)]">${edu.year}</span>
                                        </div>
                                        <h5 class="italic text-[var(--secondary-text-color)]">${edu.institution}</h5>
                                    </div>
                                `).join('')}
                                </div>
                            </div>

            <div>
                <h3 class="section-title">Skills</h3>
                <div class="flex flex-wrap gap-2 text-sm text-[var(--secondary-text-color)]">
                    ${resumeData.skills.map(skill => `
                        <span class="px-3 py-1 bg-[var(--accent-color)] rounded-full font-medium text-white">${skill}</span>
                    `).join('')}
                </div>
            </div>
        </div>
    `;

    // Re-create icons for the new preview content
    lucide.createIcons();
    // Scroll the preview to the top whenever it's re-rendered
    previewContainer.scrollTop = 0;
}

// Function to simulate an AI model. Generates static suggestions.
async function getAISuggestion(prompt) {
    // Static suggestions for a "random" feel
    const suggestions = {
        summary: [
            "Results-driven professional with 5+ years of experience in project management. Proven ability to lead cross-functional teams and deliver complex projects on time and within budget. Seeking to leverage skills in a dynamic environment.",
            "Highly motivated software engineer with a strong foundation in modern web development technologies. Passionate about building scalable and efficient applications. Eager to contribute to a collaborative, innovative team.",
            "Creative marketing specialist with a track record of developing successful digital campaigns. Expert in content strategy, social media management, and data-driven decision-making. Ready to drive brand growth and audience engagement.",
            "A seasoned administrative assistant with excellent organizational skills and a keen eye for detail. Proficient in scheduling, correspondence, and office management. Committed to supporting team success and improving operational efficiency.",
            "Dedicated healthcare professional with a passion for patient care and a commitment to maintaining a sterile, safe environment. Proven ability to manage patient records, assist with procedures, and provide compassionate support.",
            "Experienced data analyst with expertise in SQL, Python, and business intelligence tools. Skilled in transforming raw data into actionable insights to drive strategic business decisions and improve operational efficiency."
        ],
        experience: [
            "• Spearheaded the development of a new mobile application, increasing user engagement by 25% within the first six months.\n• Optimized database queries and backend processes, reducing server response time by 30%.\n• Collaborated with product managers to define project requirements and deliver features that aligned with business goals.",
            "• Managed a portfolio of 20+ key accounts, consistently exceeding sales targets by an average of 15% each quarter.\n• Developed and executed a new client onboarding process, resulting in a 10% increase in customer satisfaction.\n• Identified and pursued new business opportunities, expanding the company's market share in key regions.",
            "• Implemented a comprehensive social media marketing strategy that grew the company's follower base by 50,000.\n• Produced engaging blog posts and video content, driving a 40% increase in organic website traffic.\n• Analyzed campaign performance using Google Analytics and other tools to inform future marketing decisions.",
            "• Coordinated office activities and managed executive calendars, ensuring all meetings and appointments ran smoothly.\n• Streamlined a document filing system, reducing retrieval time by 50% and improving overall office efficiency.\n• Handled all incoming and outgoing correspondence, maintaining professionalism and accuracy at all times.",
            "• Performed phlebotomy and other lab procedures with a 99% accuracy rate, adhering strictly to safety protocols.\n• Maintained and updated patient health records with meticulous attention to detail and confidentiality.\n• Provided compassionate care and clear communication to patients, ensuring a positive experience during their visit."
        ],
        skills: [
            "JavaScript, React, Node.js, Python, AWS, Docker, PostgreSQL, MongoDB",
            "Project Management, Agile Methodologies, Scrum, JIRA, Asana, Leadership, Communication",
            "Microsoft Office Suite, Data Entry, Scheduling, Customer Service, Office Administration, CRM Software",
            "Digital Marketing, SEO, SEM, Google Analytics, Social Media Management, Content Creation",
            "Phlebotomy, Patient Care, HIPAA Compliance, Electronic Health Records (EHR), Medical Terminology",
            "SQL, Tableau, Python, R, Data Visualization, Machine Learning, Statistical Analysis, ETL"
        ],
    };

    const section = prompt.split('\n')[0].includes('summary') ? 'summary' : prompt.split('\n')[0].includes('skills') ? 'skills' : 'experience';

    const sectionSuggestions = suggestions[section] || suggestions.summary; // Default to summary if needed
    const randomSuggestion = sectionSuggestions[Math.floor(Math.random() * sectionSuggestions.length)];

    return new Promise(resolve => {
        setTimeout(() => {
            resolve(randomSuggestion);
        }, 1500); // Simulate a 1.5-second network delay
    });
}

function showSuggestionModal(title, content, onAccept) {
    const modal = document.getElementById('ai-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-content').textContent = content;

    const acceptBtn = document.getElementById('accept-suggestion-btn');
    const cancelBtn = document.getElementById('cancel-suggestion-btn');

    const handleAccept = () => {
        onAccept(content);
        closeSuggestionModal();
        acceptBtn.removeEventListener('click', handleAccept);
    };

    const handleCancel = () => {
        closeSuggestionModal();
        acceptBtn.removeEventListener('click', handleAccept);
    };

    acceptBtn.addEventListener('click', handleAccept);
    cancelBtn.addEventListener('click', handleCancel);

    modal.classList.remove('hidden');
}

function closeSuggestionModal() {
    document.getElementById('ai-modal').classList.add('hidden');
}

// Event handlers and update logic
function handleInput(event) {
    const field = event.target.dataset.field;
    const section = state.activeSection;

    const parentItem = event.target.closest('[data-index]');
    if (parentItem) {
        const itemIndex = parseInt(parentItem.dataset.index);
        state.resumeData[section][itemIndex][field] = event.target.value;
    } else {
        if (section === 'contact') {
            state.resumeData.contact[field] = event.target.value;
        } else if (section === 'summary') {
            state.resumeData.summary = event.target.value;
        } else if (section === 'skills') {
            state.resumeData.skills = event.target.value.split(',').map(s => s.trim()).filter(s => s);
        }
    }
    
    saveState();
    renderResumePreview();
}

async function handleAISuggestion(button) {
    const section = button.dataset.section;
    const initialText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `
        <svg class="animate-spin h-4 w-4 text-sky-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Loading...</span>
    `;

    let prompt = '';
    let suggestion = '';
    const resumeData = state.resumeData;

    try {
        switch (section) {
            case 'summary':
                prompt = `Generate a professional summary for a resume. The current summary is: "${resumeData.summary}". The current job title is: "${resumeData.contact.title}". The skills are: "${resumeData.skills.join(', ')}". Suggest a new summary that is professional and concise.`;
                suggestion = await getAISuggestion(prompt);
                showSuggestionModal('AI Summary Suggestion', suggestion, (newContent) => {
                    state.resumeData.summary = newContent;
                    saveState();
                    renderInputPanel();
                    renderResumePreview();
                });
                break;
            case 'experience':
                const index = parseInt(button.dataset.index);
                const job = resumeData.experience[index];
                prompt = `Generate a job description for a resume based on the following details:\nJob Title: ${job.title}\nCompany: ${job.company}\nResponsibilities: ${job.description}\nSkills: ${resumeData.skills.join(', ')}\nSuggest a new, bullet-point based description that highlights key accomplishments.`;
                suggestion = await getAISuggestion(prompt);
                showSuggestionModal('AI Experience Suggestion', suggestion, (newContent) => {
                    state.resumeData.experience[index].description = newContent;
                    saveState();
                    renderInputPanel();
                    renderResumePreview();
                });
                break;
            case 'skills':
                prompt = `Generate a list of technical skills for a professional with the following background:\nJob Title: ${resumeData.contact.title}\nSummary: "${resumeData.summary}"\nExperience: ${resumeData.experience.map(j => j.title).join(', ')}\nExisting Skills: ${resumeData.skills.join(', ')}\nSuggest a list of skills, comma-separated, that would be relevant to this profile.`;
                suggestion = await getAISuggestion(prompt);
                showSuggestionModal('AI Skills Suggestion', suggestion, (newContent) => {
                    state.resumeData.skills = newContent.split(',').map(s => s.trim()).filter(s => s);
                    saveState();
                    renderInputPanel();
                    renderResumePreview();
                });
                break;
        }
    } catch (error) {
        console.error("Failed to fetch AI suggestion:", error);
        // Implement a custom modal for error messages instead of alert
        const errorModal = document.getElementById('error-modal');
        document.getElementById('error-message').textContent = 'Failed to get a suggestion. Please try again later.';
        errorModal.classList.add('flex');
    } finally {
        button.disabled = false;
        button.innerHTML = initialText;
    }
}

// Adds an item to an array section
function addArrayItem(section) {
    let newItem = {};
    if (section === 'experience') {
        newItem = { title: 'Job Title', company: 'Company Name', startDate: 'Start Year', endDate: 'End Year', description: 'Describe your key responsibilities and achievements in bullet points. Use action verbs and quantify results wherever possible.' };
    } else if (section === 'education') {
        newItem = { degree: 'Degree / Field of Study', institution: 'University / Institution Name', year: 'Graduation Year' };
    }
    state.resumeData[section].push(newItem);
    saveState();
    renderInputPanel();
    renderResumePreview();
}

// Removes an item from an array section
function removeArrayItem(section, index) {
    state.resumeData[section].splice(index, 1);
    saveState();
    renderInputPanel();
    renderResumePreview();
}

// This function changes the active input form on the left and also scrolls the live preview to the top.
function setActiveSection(section) {
    state.activeSection = section;
    updateSectionNav();
    renderInputPanel();
    renderResumePreview();
}

function setCurrentTemplate(template) {
    state.currentTemplate = template;
    updateTemplateButtons();
    renderResumePreview();
    saveState();
}

// Function to perform a basic ATS check (the original validation)
function runBasicAtsCheck() {
    const modal = document.getElementById('ats-modal');
    const title = document.getElementById('ats-modal-title');
    const content = document.getElementById('ats-modal-content');
    const closeBtn = document.getElementById('close-ats-btn');
    
    // Show a loading message immediately
    title.textContent = 'Running Basic ATS Scan...';
    content.innerHTML = `
        <div class="flex items-center justify-center gap-2 text-slate-700">
            <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Analyzing resume format and completeness...</span>
        </div>
    `;
    closeBtn.classList.add('hidden');
    modal.classList.remove('hidden');

    // Simulate a delay before displaying results
    setTimeout(() => {
        const missingDetails = [];
        const resumeData = state.resumeData;

        // Validation Checks
        if (!resumeData.contact.name || resumeData.contact.name === 'Your Name') {
            missingDetails.push("Missing full name in the contact section.");
        }
        if (!resumeData.contact.email || resumeData.contact.email === 'your.email@example.com') {
            missingDetails.push("Missing a valid email address.");
        }
        if (!resumeData.contact.phone || resumeData.contact.phone === '(123) 456-7890') {
            missingDetails.push("Missing a phone number.");
        }
        if (!resumeData.summary || resumeData.summary === 'A brief, impactful summary of your professional experience, skills, and goals. Mention key accomplishments and what you bring to the table.') {
            missingDetails.push("Missing a professional summary.");
        }
        if (resumeData.experience.length === 0 || (!resumeData.experience[0].title && !resumeData.experience[0].company)) {
            missingDetails.push("No work experience details have been entered.");
        }
        if (resumeData.education.length === 0 || (!resumeData.education[0].degree && !resumeData.education[0].institution)) {
            missingDetails.push("No education details have been entered.");
        }
        if (resumeData.skills.length === 0 || (resumeData.skills.length === 1 && resumeData.skills[0] === 'Skill 1')) {
            missingDetails.push("No skills have been entered.");
        }

        // Conditional Reporting
        if (missingDetails.length > 0) {
            title.textContent = 'Basic ATS Check: Needs Improvement';
            closeBtn.className = 'px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors';
            
            let missingDetailsHtml = missingDetails.map(item => `<li><strong class="font-semibold text-red-700">Warning:</strong> ${item}</li>`).join('');

            content.innerHTML = `
                <p class="text-slate-900 font-medium mb-2">Your resume is missing some crucial information for ATS compatibility.</p>
                <ul class="list-disc list-inside text-sm text-slate-600 space-y-1">
                    ${missingDetailsHtml}
                </ul>
                <p class="mt-4 text-xs italic text-slate-500">Fill out these sections to improve your ATS score and get better results!</p>
            `;
            
        } else {
            // Excellent Report (original)
            title.textContent = 'Basic ATS Check: Excellent! 🎉';
            closeBtn.className = 'px-4 py-2 text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors';
            content.innerHTML = `
                <p class="text-slate-900 font-medium mb-2">Your resume has an excellent chance of passing through a basic Applicant Tracking System.</p>
                <ul class="list-disc list-inside text-sm text-slate-600 space-y-1">
                    <li><strong class="font-semibold">Clean Formatting:</strong> Your resume uses a standard, readable structure.</li>
                    <li><strong class="font-semibold">Standard Sections:</strong> All key sections like "Contact," "Experience," and "Education" are present and clearly labeled.</li>
                </ul>
            `;
        }

        closeBtn.classList.remove('hidden');
    }, 2000); // 2-second delay
}

// Utility function to normalize text and extract keywords
function extractKeywords(text) {
    const stopWords = new Set(['a', 'an', 'the', 'and', 'or', 'to', 'in', 'of', 'for', 'with', 'on', 'at', 'by', 'as', 'but', 'is', 'it', 'its', 'itself', 'he', 'him', 'his', 'she', 'her', 'hers', 'himself', 'herself', 'they', 'them', 'their', 'theirs', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'i', 'me', 'my', 'myself', 'you', 'your', 'yours', 'yourself', 'we', 'our', 'ours', 'ourselves', 'from', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'about', 'above', 'below', 'after', 'before', 'through', 'during', 'without', 'among', 'amongst', 'sometime', 'therefore', 'between', 'into', 'upon', 'onto', 'while', 'if', 'else', 'via', 'etc', 'e.g', 'i.e', 'etc']);
    return new Set(text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(word => word.length > 2 && !stopWords.has(word)));
}

// Main function for the new ATS Job Match feature
async function runAtsJobMatch() {
    const jobDescription = document.getElementById('job-description-input').value;
    const inputModal = document.getElementById('ats-input-modal');
    const resultsModal = document.getElementById('ats-results-modal');
    const resultsTitle = document.getElementById('ats-results-title');
    const resultsContent = document.getElementById('ats-results-content');
    const closeResultsBtn = document.getElementById('close-ats-results-btn');

    if (!jobDescription.trim()) {
        alert("Please paste a job description to run the match.");
        return;
    }

    inputModal.classList.add('hidden');
    resultsModal.classList.remove('hidden');

    // Show a loading state
    resultsTitle.textContent = 'Running ATS Job Match...';
    resultsContent.innerHTML = `
        <div class="flex items-center justify-center gap-2 text-slate-700">
            <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Comparing keywords and skills...</span>
        </div>
    `;
    closeResultsBtn.classList.add('hidden');

    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate delay

    // Extract keywords from resume
    const resumeText = JSON.stringify(state.resumeData);
    const resumeKeywords = extractKeywords(resumeText);
    
    // Extract keywords from job description
    const jobKeywords = extractKeywords(jobDescription);

    const foundKeywords = new Set();
    const missingKeywords = new Set(jobKeywords);

    jobKeywords.forEach(keyword => {
        if (resumeKeywords.has(keyword)) {
            foundKeywords.add(keyword);
            missingKeywords.delete(keyword);
        }
    });

    const totalKeywords = jobKeywords.size;
    const score = totalKeywords > 0 ? Math.round((foundKeywords.size / totalKeywords) * 100) : 0;

    let scoreColor = 'bg-red-500';
    if (score > 75) scoreColor = 'bg-green-500';
    else if (score > 50) scoreColor = 'bg-yellow-500';

    resultsTitle.textContent = 'ATS Match Report';
    resultsContent.innerHTML = `
        <div class="text-center p-4 rounded-lg">
            <div class="text-xs font-semibold text-slate-500">Match Score</div>
            <div class="text-6xl font-bold ${scoreColor} text-white inline-flex px-6 py-4 rounded-full mt-2">
                ${score}%
            </div>
            <p class="text-sm mt-4 text-slate-600">This score indicates how well your resume's keywords match the job description.</p>
        </div>
        
        <div>
            <h4 class="text-base font-semibold text-green-700 mb-2">Keywords Found (${foundKeywords.size})</h4>
            <div class="flex flex-wrap gap-2">
                ${Array.from(foundKeywords).map(k => `<span class="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">${k}</span>`).join('')}
            </div>
        </div>

        <div>
            <h4 class="text-base font-semibold text-red-700 mb-2">Keywords Missing (${missingKeywords.size})</h4>
            <div class="flex flex-wrap gap-2">
                ${Array.from(missingKeywords).map(k => `<span class="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs">${k}</span>`).join('')}
            </div>
        </div>
        <p class="mt-4 text-xs italic text-slate-500">Add the missing keywords to your resume to increase your match score.</p>
    `;

    closeResultsBtn.classList.remove('hidden');
}


// Function to generate and display the cover letter
async function generateCoverLetter() {
    const modal = document.getElementById('cover-letter-modal');
    const contentTextarea = document.getElementById('cover-letter-content');
    const copyBtn = document.getElementById('copy-cover-letter-btn');
    const closeBtn = document.getElementById('close-cover-letter-btn');

    modal.classList.remove('hidden');

    // Show a loading state
    contentTextarea.value = 'Generating your cover letter...';
    contentTextarea.disabled = true;
    copyBtn.disabled = true;

    // Simulate AI generation with a delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Check if the necessary data is available
    const name = state.resumeData.contact.name;
    const title = state.resumeData.contact.title;
    const summary = state.resumeData.summary;

    if (name === 'Your Name' || title === 'Your Job Title' || summary === 'A brief, impactful summary of your professional experience, skills, and goals. Mention key accomplishments and what you bring to the table.') {
        contentTextarea.value = "Please fill in your name, job title, and a professional summary before generating a cover letter.";
    } else {
        const coverLetterTemplate = `
[Date]

[Hiring Manager Name] (or "Hiring Manager")
[Hiring Manager Title]
[Company Name]
[Company Address]

Dear [Hiring Manager Name] (or "Hiring Manager"),

I am writing to express my strong interest in the [Job Title] position at [Company Name]. As a highly skilled ${title} with a proven track record of success, I am confident that my experience and skills align perfectly with the requirements of this role.

${summary}

In my previous roles, I have developed a strong foundation in [mention 1-2 key skills from your resume, e.g., project management, team leadership, technical skills], which I believe would be a valuable asset to your team.

Thank you for your time and consideration. I am excited about the possibility of contributing to [Company Name] and am available for an interview at your earliest convenience.

Sincerely,

${name}
${state.resumeData.contact.phone}
${state.resumeData.contact.email}
`;
        contentTextarea.value = coverLetterTemplate.trim();
    }
    
    contentTextarea.disabled = false;
    copyBtn.disabled = false;
    copyBtn.textContent = 'Copy to Clipboard';
}

// Function to handle copying the content
function copyCoverLetter() {
    const contentTextarea = document.getElementById('cover-letter-content');
    const copyBtn = document.getElementById('copy-cover-letter-btn');

    contentTextarea.select();
    document.execCommand('copy');
    
    copyBtn.textContent = 'Copied!';
    
    setTimeout(() => {
        copyBtn.textContent = 'Copy to Clipboard';
    }, 2000);
}

// Function to export the resume to a PDF.
function exportToPDF() {
    const previewContainer = document.getElementById('resume-preview-container');
    const resumeElement = previewContainer.querySelector('.template-container');
    const parent = resumeElement.parentElement; // The preview container

    // Temporarily create a new, detached container
    const tempContainer = document.createElement('div');
    tempContainer.style.width = '210mm'; // A4 width
    tempContainer.style.padding = '0';
    tempContainer.style.margin = '0';

    // Move the resume element to the temporary container to bypass fixed heights
    tempContainer.appendChild(resumeElement);
    document.body.appendChild(tempContainer);

    const options = {
        margin: [0, 10, 10, 10], // top, left, bottom, right in millimeters
        filename: `${state.resumeData.contact.name.replace(/\s/g, '_')}_Resume.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().from(tempContainer).set(options).save().then(() => {
        // Move the resume element back to its original parent
        parent.appendChild(resumeElement);
        // Clean up the temporary container
        document.body.removeChild(tempContainer);
    });
}

// Function to export the resume as a simple HTML file.
function exportToHTML() {
    const previewContainer = document.getElementById('resume-preview-container');
    const resumeContent = previewContainer.querySelector('.template-container').innerHTML;

    // Fetch the CSS content from style.css
    fetch('style.css')
        .then(response => response.text())
        .then(css => {
            // Construct a complete HTML file with embedded CSS
            const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${state.resumeData.contact.name.replace(/\s/g, ' ')}'s Resume</title>
    <style>
        body {
            font-family: 'Inter', sans-serif;
            background-color: #ffffff;
            margin: 0;
            padding: 0;
            color: #1e293b;
        }
        .template-container {
            /* Adjusted padding to match the PDF export margins */
            padding: 0mm 10mm 10mm 10mm;
            background-color: #fff;
            box-shadow: none;
            border-radius: 0;
            max-width: 8.5in;
            margin: 0 auto;
            color: #1e293b;
            font-size: 11pt;
        }
        /* Embed the entire CSS file content here */
        ${css}
    </style>
</head>
<body>
    <div class="template-container ${state.currentTemplate}">
        ${resumeContent}
    </div>
</body>
</html>
            `;

            // Create a Blob and a downloadable link
            const blob = new Blob([html], { type: 'text/html' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${state.resumeData.contact.name.replace(/\s/g, '_')}_Resume.html`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        })
        .catch(error => {
            console.error('Error fetching CSS:', error);
            const errorModal = document.getElementById('error-modal');
            document.getElementById('error-message').textContent = 'Failed to export HTML. Could not load stylesheet.';
            errorModal.classList.add('flex');
        });
}

// UI event listeners and initial rendering
function setupEventListeners() {
    // Event delegation for the dynamic input fields and buttons
    document.getElementById('input-sections').addEventListener('input', (event) => {
        if (event.target.classList.contains('input-field') || event.target.classList.contains('textarea-field')) {
            handleInput(event);
        }
    });
    
    document.getElementById('input-sections').addEventListener('click', (event) => {
        const target = event.target;
        if (target.classList.contains('ai-suggestion-btn')) {
            handleAISuggestion(target);
        } else if (target.closest('.add-btn')) {
            addArrayItem(target.closest('.add-btn').dataset.section);
        } else if (target.closest('.remove-btn')) {
            const btn = target.closest('.remove-btn');
            removeArrayItem(btn.dataset.section, parseInt(btn.dataset.index));
        }
    });

    // Template buttons
    document.querySelectorAll('.template-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const templateId = e.currentTarget.id.replace('-btn', '');
            setCurrentTemplate(templateId);
        });
    });

    // Export buttons
    document.getElementById('basic-ats-check-btn').addEventListener('click', runBasicAtsCheck);
    document.getElementById('ats-job-match-btn').addEventListener('click', () => {
        document.getElementById('ats-input-modal').classList.remove('hidden');
    });
    document.getElementById('run-ats-match-btn').addEventListener('click', runAtsJobMatch);
    
    document.getElementById('generate-cover-letter-btn').addEventListener('click', generateCoverLetter);
    document.getElementById('export-pdf-btn').addEventListener('click', exportToPDF);
    document.getElementById('export-html-btn').addEventListener('click', exportToHTML);
    
    // Modal close buttons
    document.getElementById('close-ats-btn').addEventListener('click', () => {
        document.getElementById('ats-modal').classList.add('hidden');
    });
    document.getElementById('close-cover-letter-btn').addEventListener('click', () => {
        document.getElementById('cover-letter-modal').classList.add('hidden');
    });
    document.getElementById('close-ats-input-btn').addEventListener('click', () => {
        document.getElementById('ats-input-modal').classList.add('hidden');
    });
    document.getElementById('close-ats-results-btn').addEventListener('click', () => {
        document.getElementById('ats-results-modal').classList.add('hidden');
    });
    document.getElementById('close-error-modal').addEventListener('click', () => {
        document.getElementById('error-modal').classList.remove('flex');
    });

    // Section navigation buttons
    const sections = Object.keys(state.resumeData).filter(s => s !== 'currentTemplate');
    const sectionNav = document.getElementById('section-nav');
    sections.forEach(section => {
        const button = document.createElement('button');
        button.textContent = section.charAt(0).toUpperCase() + section.slice(1);
        button.id = `${section}-nav-btn`;
        button.className = 'px-4 py-2 rounded-full font-medium transition-all duration-200 text-sm';
        button.onclick = () => setActiveSection(section);
        sectionNav.appendChild(button);
    });

    // Initial button state
    updateSectionNav();
    updateTemplateButtons();
}

function updateSectionNav() {
    document.querySelectorAll('#section-nav button').forEach(btn => {
        const sectionId = btn.id.replace('-nav-btn', '');
        if (sectionId === state.activeSection) {
            btn.className = 'px-4 py-2 rounded-full font-medium transition-all duration-200 text-sm bg-sky-600 text-white shadow-lg';
        } else {
            btn.className = 'px-4 py-2 rounded-full font-medium transition-all duration-200 text-sm bg-slate-100 text-slate-600 hover:bg-sky-100 hover:text-sky-700';
        }
    });
}

function updateTemplateButtons() {
    document.querySelectorAll('.template-btn').forEach(btn => {
        const templateId = btn.id.replace('-btn', '');
        if (templateId === state.currentTemplate) {
            // New styling for the active buttons
            let activeClasses = 'template-btn active flex flex-col items-center p-3 rounded-lg border-2 transition-all duration-200 shadow-md';
            
            // Apply a different color for the Classic button
            if (templateId === 'classic') {
                activeClasses += ' border-slate-600 bg-slate-200';
            } else {
                activeClasses += ' border-sky-500 bg-sky-50';
            }

            btn.className = activeClasses;
        } else {
            // Inactive button styling remains the same
            btn.className = 'template-btn flex flex-col items-center p-3 rounded-lg border-2 transition-all duration-200 border-slate-200 hover:bg-slate-50';
        }

        // Add the button-specific color to the span inside
        const buttonSpan = btn.querySelector('.btn-template-name');
        if (buttonSpan) {
            if (templateId === 'modern') {
                buttonSpan.className = 'btn-template-name text-sm';
            } else if (templateId === 'classic') {
                buttonSpan.className = 'btn-template-name text-sm text-slate-900';
            } else if (templateId === 'professional') {
                buttonSpan.className = 'btn-template-name text-sm';
            }
        }
    });
}

// Initial application load
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupEventListeners();
    renderInputPanel();
    renderResumePreview();
});

// Expose functions globally so they can be called from onclick attributes in the HTML
window.setActiveSection = setActiveSection;
window.setCurrentTemplate = setCurrentTemplate;
window.exportToPDF = exportToPDF; // Expose to global scope for testing or direct calls
window.exportToHTML = exportToHTML; // Expose to global scope