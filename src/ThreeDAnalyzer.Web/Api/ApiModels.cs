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

public record CreatePartRequest(string PartNumber, string? PartDescription);

public record UpdatePartRequest(
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

public record ImportPartsResult(int Imported, int Skipped, IReadOnlyList<string> Errors);

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

public record CycleTimePayload(
    System.Text.Json.JsonElement? Values,
    System.Text.Json.JsonElement? Operations,
    System.Text.Json.JsonElement? Other,
    System.Text.Json.JsonElement? RawMaterial,
    System.Text.Json.JsonElement? FinishPart,
    System.Text.Json.JsonElement? Model3d,
    System.Text.Json.JsonElement? Computed,
    int? Version,
    string? UpdatedAt);

public record CycleTimeResponse(object? CycleTimeData);

public record MachineProfileDto(
    int Id,
    string Name,
    string AxisTypes,
    double RapidRateMmpm,
    double SpindlePowerKw,
    double AccelDecelFactor,
    double ToolChangeTimeSec,
    string CreatedBy,
    string CreatedDate,
    string Status);

public record CreateMachineProfileRequest(
    string Name,
    string AxisTypes,
    double RapidRateMmpm,
    double SpindlePowerKw,
    double AccelDecelFactor,
    double ToolChangeTimeSec,
    string CreatedBy,
    string CreatedDate,
    string? Status);

public record UpdateMachineProfileRequest(
    string AxisTypes,
    double RapidRateMmpm,
    double SpindlePowerKw,
    double AccelDecelFactor,
    double ToolChangeTimeSec,
    string CreatedBy,
    string CreatedDate,
    string Status);

public record OperationTemplateDto(
    int Id,
    string Name,
    string OperationType,
    object Params,
    string CreatedBy,
    string CreatedDate,
    string Status);

public record CreateOperationTemplateRequest(
    string Name,
    string OperationType,
    System.Text.Json.JsonElement? Params,
    string CreatedBy,
    string CreatedDate,
    string? Status);

public record UpdateOperationTemplateRequest(
    string Name,
    string OperationType,
    System.Text.Json.JsonElement? Params,
    string CreatedBy,
    string CreatedDate,
    string Status);

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
