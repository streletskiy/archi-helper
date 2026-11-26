(
    local adapter = (getFilenamePath (getSourceFileName())) + "archi_helper.py"
    if doesFileExist adapter do
    (
        try (python.ExecuteFile adapter)
        catch (format "Archi Helper: %\n" (getCurrentException()))
    )
)
