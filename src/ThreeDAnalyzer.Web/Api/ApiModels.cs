namespace ThreeDAnalyzer.Web.Api;

public record ProjectDto(int Id, string Name, string DateRegistered, string Owner, string Status);

public record PartDto(
    int Id,
    int ProjectId,
    string Aircraft,
    int No,
    string PartNumber,
    string PartDescription,
    string Picture,
    int Qpa,
    int FirstLaunchQty,
    string FirstDelivery,
    string MaterialSpec,
    double FinishThickness,
    double FinishWidth,
    double FinishLength,
    double MaterialRulingDim,
    double MaterialThickness,
    double MaterialWidth,
    double MaterialLength,
    int QtyPerBillet,
    double SetupTimeHour,
    double CycleTurnMill,
    double Cycle3x,
    double Cycle4x,
    double Cycle5x,
    double CycleTotalHrs);

public record UserDto(int Id, string Username, string Password, string DisplayName, string Status);

public record MaterialSpecDto(
    int Id,
    string Specification,
    string GeneralName,
    string MaterialType,
    double Density,
    string CreatedBy,
    string CreatedDate,
    string Status);

public record CycleTimePayload(System.Text.Json.JsonElement? Values, string? UpdatedAt);

public record CycleTimeResponse(object? CycleTimeData);

public record CreateUserRequest(string Username, string Password, string DisplayName, string? Status);

public record UpdateUserRequest(string Password, string DisplayName, string Status);

public record CreateMaterialSpecRequest(
    string Specification,
    string GeneralName,
    string MaterialType,
    double Density,
    string CreatedBy,
    string CreatedDate,
    string? Status);

public record UpdateMaterialSpecRequest(
    string GeneralName,
    string MaterialType,
    double Density,
    string CreatedBy,
    string CreatedDate,
    string Status);
