function createMobileBlocker() {
  // Create the mobile blocker element
  const mobileBlocker = document.createElement("div");
  mobileBlocker.className = "mobile-blocker";

  // Create the text element
  const text = document.createElement("p");
  text.className = "mobile-blocker__text";
  text.textContent =
    "This app is only available for desktop screen sizes. Use a device with a larger screen.";

  // Append text to blocker
  mobileBlocker.appendChild(text);

  // Append blocker to body
  document.body.appendChild(mobileBlocker);
}

// Initialize mobile blocker when DOM is loaded
document.addEventListener("DOMContentLoaded", createMobileBlocker);
