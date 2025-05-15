# Backing Track Player

A backing track player built using Python and Flask that is light-weight and supports multiple OS-s! Uses the BASS audio library. You can configure setlists and choose different outputs for all audio files in a song.
A bachelor's thesis project in the University of Tartu, Estonia. 2025.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

* **Python:** [python.org](https://www.python.org/)
* **pip** 
* **Git:**  [git-scm.com](https://git-scm.com/)

## Setup Instructions (Running from Source)

Follow these steps to get the application running directly from the source code on your local machine:

1.  **Clone the Repository:**
    Open your terminal or command prompt and run:
    ```bash
    git clone https://github.com/johannmkammiste/btplayer btplayer
    cd backingtrackplayer
    ```

2.  **Create and Activate a Virtual Environment:**
    ```bash
    # Create the virtual environment (use python3 if python maps to Python 2)
    python -m venv venv
    # Activate the virtual environment:
    # On Windows:
    venv\Scripts\activate
    # On macOS/Linux:
    source venv/bin/activate
    ```
    You should see `(venv)` at the beginning of your terminal prompt.

3.  **Install Dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

4. **Running the Application (from Source)**
    
    Once setup has finished, you can run the app using this command: 
 
    ```bash
    python run.py
    ```

## Creating an OS specific app

You can also create an excecutable using pyinstaller.

1. **Install pyinstall**
    ```bash
    pip install pyinstaller
    ```
2. **Run pyinstaller with the following command:**
   ```bash
   pyinstaller --name BackingTrackPlayer --onefile --add-data "templates:templates" --add-data "static:static" --add-data "data:data" --add-data "app.py:." --collect-all modpybass run.py
   ```

## Running on Startup (Linux)

This project was mostly designed with a SBC in mind. So here are the instructions to use it with DietPi:

1. **Install DietPi and do the initial setup**
   
   The author used a ASUS Tinker Board 2 with a 7" touchscreen.

    Installation and setup instructions for DietPi here: [https://dietpi.com/docs/install/]. Keep the root user as default.

    Make sure you setup an internet connection and enable sound. 
    
    Install the following programs:
    xcfe, python, git, chromium.

2. **Download and setup this repo and setup autostart**

    Make sure you are in the root user.
    ```bash
    wget https://github.com/johannmkammiste/btplayer/archive/refs/heads/main.zip
   unzip main.zip
   cd backingtrackplayer
   apt install python3-venv
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   mv chromium-autostart.sh /var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh
   dietpi-autostart 11
    ```
   Reboot Pi and all should be working well :)



