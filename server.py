from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.request
import json
import os
from datetime import datetime, timedelta
import hashlib
import requests
import sys

# Add the current directory to the Python path to allow importing apiKey
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from apiKey import N2YO_API_KEY

# Cache settings
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
CACHE_DURATION = timedelta(hours=2)  # Cache for 2 hours
FALLBACK_DATA_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "data", "json", "satellites.json"
)
MOCK_DATA_PATH = "./data/json/satellites.json"  # Path to mock data

# Create cache directory if it doesn't exist
if not os.path.exists(CACHE_DIR):
    os.makedirs(CACHE_DIR)
    print(f"Created cache directory: {CACHE_DIR}")


def get_cache_path(url):
    """Generate a unique cache file path for a URL"""
    # Create a hash of the URL to use as the filename
    url_hash = hashlib.md5(url.encode()).hexdigest()
    cache_file = os.path.join(CACHE_DIR, f"{url_hash}.json")
    print(f"Cache file path: {cache_file}")  # Debug log
    return cache_file


def is_cache_valid(cache_path):
    """Check if the cache file exists and is not expired"""
    if not os.path.exists(cache_path):
        print(f"Cache file does not exist: {cache_path}")  # Debug log
        return False

    # Check if the cache is expired
    file_time = datetime.fromtimestamp(os.path.getmtime(cache_path))
    is_valid = datetime.now() - file_time < CACHE_DURATION
    print(
        f"Cache file age: {datetime.now() - file_time}, Valid: {is_valid}"
    )  # Debug log
    return is_valid


def save_to_cache(cache_path, data):
    """Save data to cache file"""
    try:
        with open(cache_path, "wb") as f:
            f.write(data)
        print(f"Successfully saved data to cache: {cache_path}")
    except Exception as e:
        print(f"Error saving to cache: {e}")
        print(f"Cache path: {cache_path}")
        print(f"Cache directory exists: {os.path.exists(CACHE_DIR)}")
        print(f"Cache directory is writable: {os.access(CACHE_DIR, os.W_OK)}")


def load_from_cache(cache_path):
    """Load data from cache file"""
    try:
        with open(cache_path, "rb") as f:
            data = f.read()
            print(f"Successfully loaded data from cache: {cache_path}")
            return data
    except Exception as e:
        print(f"Error loading from cache: {e}")
        print(f"Cache path: {cache_path}")
        return None


def load_mock_data():
    try:
        with open(MOCK_DATA_PATH, "rb") as f:
            return f.read()
    except Exception as e:
        print(f"Error loading mock data: {str(e)}")
        return None


def load_fallback_data():
    try:
        with open(FALLBACK_DATA_PATH, "rb") as f:
            return f.read()
    except Exception as e:
        print(f"Error loading fallback data: {str(e)}")
        return None


class ProxyHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/n2yo/"):
            # Handle N2YO API requests
            # Remove the /api/n2yo/ prefix and construct the proper URL
            api_path = self.path[10:]  # Remove /api/n2yo/
            base_url = "https://api.n2yo.com/rest/v1/satellite"

            # Handle different endpoints
            if api_path.startswith("positions/"):
                # For positions endpoint
                url = f"{base_url}/positions/{api_path[10:]}"
            elif api_path.startswith("above/"):
                # For above endpoint
                url = f"{base_url}/above/{api_path[6:]}"
            else:
                # For other endpoints
                url = f"{base_url}/{api_path}"

            # Ensure apiKey is properly formatted
            if "?" in url:
                url = url.replace("&apiKey=", "&apiKey=")
            else:
                url = url.replace("?apiKey=", "?apiKey=")

            try:
                print(f"Requesting N2YO API URL: {url}")  # Debug log
                with urllib.request.urlopen(url) as response:
                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(response.read())
            except urllib.error.HTTPError as e:
                print(f"N2YO API error: {e.code} - {e.reason}")
                # Try to read the error response
                try:
                    error_body = e.read().decode("utf-8")
                    print(f"Error details: {error_body}")
                except:
                    pass
                # Forward the original error status code and message
                self.send_error(e.code, f"N2YO API error: {e.reason}")
            except Exception as e:
                print(f"Unexpected N2YO API error: {str(e)}")
                self.send_error(500, str(e))
        elif self.path.startswith("/api/celestrak/"):
            # Handle Celestrak API requests
            # Construct the proper URL for Celestrak API
            base_url = "https://celestrak.org/NORAD/elements"
            query = self.path.split("?")[1] if "?" in self.path else ""
            url = f"{base_url}/gp.php?{query}"
            cache_path = get_cache_path(url)

            print(f"Checking cache for: {url}")
            print(f"Cache path: {cache_path}")

            # Try to use cache first
            if is_cache_valid(cache_path):
                print("Using cached Celestrak data")
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("X-Data-Source", "cache")
                self.end_headers()
                self.wfile.write(load_from_cache(cache_path))
                return

            try:
                # Fetch from API
                print("Fetching fresh data from Celestrak API")
                req = urllib.request.Request(url)
                req.add_header("User-Agent", "Mozilla/5.0")  # Add a user agent header
                with urllib.request.urlopen(req) as response:
                    data = response.read()
                    # Save to cache
                    save_to_cache(cache_path, data)
                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("X-Data-Source", "api")
                    self.end_headers()
                    self.wfile.write(data)
            except urllib.error.HTTPError as e:
                print(f"Celestrak API error: {e.code} - {e.reason}")
                # Try to use expired cache if available
                if os.path.exists(cache_path):
                    print("Using expired cache as fallback")
                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("X-Data-Source", "fallback")
                    self.end_headers()
                    self.wfile.write(load_from_cache(cache_path))
                else:
                    # Try to use fallback data
                    try:
                        print("Using fallback data")
                        with open(FALLBACK_DATA_PATH, "rb") as f:
                            self.send_response(200)
                            self.send_header("Content-type", "application/json")
                            self.send_header("Access-Control-Allow-Origin", "*")
                            self.send_header("X-Data-Source", "fallback")
                            self.end_headers()
                            self.wfile.write(f.read())
                    except Exception as e:
                        print(f"Error loading fallback data: {e}")
                        self.send_error(500, str(e))
            except Exception as e:
                print(f"Unexpected error: {e}")
                self.send_error(500, str(e))
        else:
            # Handle static files
            return SimpleHTTPRequestHandler.do_GET(self)


def run(server_class=HTTPServer, handler_class=ProxyHandler, port=8000):
    server_address = ("", port)
    httpd = server_class(server_address, handler_class)
    print(f"Starting server on port {port}...")
    print("Cache directory:", os.path.abspath(CACHE_DIR))
    print("Cache duration:", CACHE_DURATION)
    print("Fallback data path:", os.path.abspath(FALLBACK_DATA_PATH))
    httpd.serve_forever()


if __name__ == "__main__":
    run()
